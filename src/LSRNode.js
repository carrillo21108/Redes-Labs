const Strophe = require("strophe.js");
const fs = require("fs");

class LSRNode {
  constructor(nodeId, password) {
    this.nodeId = nodeId;
    this.password = password;
    this.jid = null;
    this.neighbors = [];
    this.connection = null;
    this.messagesSeen = new Set();
    this.topologyMap = new Map();
    this.routingTable = new Map();

    this.loadConfigurations();
    this.setupXMPP();
  }

  loadConfigurations() {
    const topoData = JSON.parse(fs.readFileSync("data/topo-flood.txt", "utf8"));
    const namesData = JSON.parse(
      fs.readFileSync("data/names-flood.txt", "utf8")
    );

    if (topoData.type !== "topo" || !topoData.config[this.nodeId]) {
      throw new Error("Invalid topology configuration or node not found");
    }
    if (namesData.type !== "names" || !namesData.config[this.nodeId]) {
      throw new Error("Invalid names configuration or node not found");
    }

    this.jid = namesData.config[this.nodeId];

    // Convert neighbor node IDs to JIDs
    this.neighbors = topoData.config[this.nodeId].map((neighborId) => {
      const neighborJid = namesData.config[neighborId];
      if (!neighborJid) {
        throw new Error(`No JID found for neighbor node ${neighborId}`);
      }
      return neighborJid;
    });

    console.log(`Node ${this.nodeId} configured with JID ${this.jid}`);
    console.log(`Neighbors: ${this.neighbors.join(", ")}`);

    // Initialize topologyMap with this node's information
    this.topologyMap.set(this.jid, {
      node: this.jid,
      neighbors: this.neighbors,
      timestamp: Date.now(),
    });
  }

  setupXMPP() {
    this.connection = new Strophe.Connection(
      "wss://alumchat.lol:5280/websocket"
    );
    this.connection.connect(this.jid, this.password, this.onConnect.bind(this));
  }

  onConnect(status) {
    if (status === Strophe.Status.CONNECTED) {
      console.log("Connected as " + this.jid);
      this.connection.addHandler(
        this.onMessage.bind(this),
        null,
        "message",
        "chat"
      );
      this.connection.send($pres().tree());
      this.discoverNeighbors();
      setInterval(() => this.broadcastLinkState(), 30000); // Update every 30 seconds
    } else if (status === Strophe.Status.DISCONNECTED) {
      console.log("Disconnected");
    }
  }

  discoverNeighbors() {
    this.neighbors.forEach((neighborId) => {
      const neighborJid = this.resolveJid(neighborId);
      if (neighborJid) {
        this.sendMessage({
          type: "hello",
          from: this.jid,
          to: neighborJid,
          hops: 0,
          payload: "Hello neighbor!",
        });
      }
    });
  }

  resolveJid(nodeId) {
    const namesData = JSON.parse(fs.readFileSync("names-flood.txt", "utf8"));
    return namesData.config[nodeId];
  }

  sendMessage(message) {
    message.hops = (message.hops || 0) + 1;
    const msg = $msg({ to: message.to, from: this.jid, type: "chat" })
      .c("body")
      .t(JSON.stringify(message));
    this.connection.send(msg.tree());
  }

  onMessage(stanza) {
    const from = stanza.getAttribute("from");
    const body = stanza.getElementsByTagName("body")[0];
    if (body) {
      const message = JSON.parse(body.textContent);
      this.handleMessage(message);
    }
    return true;
  }

  handleMessage(message) {
    const messageId = `${message.type}-${message.from}-${message.to}`;
    if (this.messagesSeen.has(messageId)) return;
    this.messagesSeen.add(messageId);

    console.log(`Received message: ${JSON.stringify(message)}`);

    switch (message.type) {
      case "hello":
        this.handleHello(message);
        break;
      case "message":
        this.handleChatMessage(message);
        break;
      case "lsr_update":
        this.handleLSRUpdate(message);
        break;
    }
  }

  handleHello(message) {
    console.log(`Received hello from ${message.from}`);
  }

  handleChatMessage(message) {
    if (message.to === this.jid) {
      console.log(`Message for me: ${message.payload}`);
    } else {
      this.forwardMessage(message);
    }
  }

  forwardMessage(message) {
    const nextHop = this.routingTable.get(message.to);
    if (nextHop) {
      const forwardedMessage = { ...message, hops: message.hops + 1 };
      this.sendMessage({ ...forwardedMessage, to: nextHop });
    } else {
      console.log(`No route to ${message.to}`);
    }
  }

  broadcastLinkState() {
    const linkState = {
      type: "lsr_update",
      from: this.jid,
      to: "all",
      hops: 0,
      payload: JSON.stringify({
        node: this.jid,
        neighbors: this.neighbors,
        timestamp: Date.now(),
      }),
    };
    this.neighbors.forEach((neighborJid) => {
      this.sendMessage({ ...linkState, to: neighborJid });
    });
  }

  handleLSRUpdate(message) {
    const linkState = JSON.parse(message.payload);
    const existingUpdate = this.topologyMap.get(linkState.node);
    if (!existingUpdate || existingUpdate.timestamp < linkState.timestamp) {
      this.topologyMap.set(linkState.node, linkState);
      this.recalculateRoutes();

      // Forward the update to neighbors
      this.neighbors.forEach((neighborId) => {
        const neighborJid = this.resolveJid(neighborId);
        if (neighborJid && neighborJid !== message.from) {
          this.sendMessage({
            ...message,
            to: neighborJid,
            hops: message.hops + 1,
          });
        }
      });
    }
  }

  recalculateRoutes() {
    // Dijkstra's algorithm
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(this.topologyMap.keys());

    for (let node of unvisited) {
      distances.set(node, Infinity);
    }
    distances.set(this.jid, 0);

    while (unvisited.size > 0) {
      const current = Array.from(unvisited).reduce((a, b) =>
        distances.get(a) < distances.get(b) ? a : b
      );

      unvisited.delete(current);

      if (this.topologyMap.has(current)) {
        for (let neighbor of this.topologyMap.get(current).neighbors) {
          const alt = distances.get(current) + 1;
          if (alt < distances.get(neighbor)) {
            distances.set(neighbor, alt);
            previous.set(neighbor, current);
          }
        }
      }
    }

    // Build routing table
    this.routingTable.clear();
    for (let [destination, _] of distances) {
      if (destination !== this.jid) {
        let path = destination;
        while (
          previous.get(path) !== this.jid &&
          previous.get(path) !== undefined
        ) {
          path = previous.get(path);
        }
        this.routingTable.set(destination, path);
      }
    }

    console.log("Updated routing table:", this.routingTable);
  }

  sendChatMessage(to, payload) {
    const toJid = this.resolveJid(to);
    if (!toJid) {
      console.log(`Cannot resolve JID for node ${to}`);
      return;
    }
    const message = {
      type: "message",
      from: this.jid,
      to: toJid,
      hops: 0,
      payload: payload,
      headers: [],
    };
    this.handleMessage(message);
  }
}

// Usage
const node = new LSRNode("A", "passwordA");
