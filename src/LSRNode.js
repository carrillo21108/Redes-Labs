const XMPP = require("simple-xmpp");

class LSRNode {
  constructor(jid, password, neighbors) {
    this.jid = jid;
    this.password = password;
    this.neighbors = neighbors;
    this.xmpp = new XMPP();
    this.messagesSeen = new Set();
    this.topologyMap = new Map();
    this.routingTable = new Map();

    this.setupXMPP();
  }

  setupXMPP() {
    this.xmpp.connect({
      jid: this.jid,
      password: this.password,
      host: "alumchat.lol",
      port: 5222,
    });

    this.xmpp.on("online", () => {
      console.log("Connected as " + this.jid);
      this.discoverNeighbors();
      setInterval(() => this.broadcastLinkState(), 30000); // Update every 30 seconds
    });

    this.xmpp.on("chat", (from, message) => {
      this.handleMessage(JSON.parse(message));
    });
  }

  discoverNeighbors() {
    this.neighbors.forEach((neighbor) => {
      this.sendMessage({
        type: "hello",
        from: this.jid,
        to: neighbor,
        hops: 0,
        payload: "Hello neighbor!",
      });
    });
  }

  sendMessage(message) {
    message.hops = (message.hops || 0) + 1;
    this.xmpp.send(message.to, JSON.stringify(message));
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
    if (!this.neighbors.includes(message.from)) {
      this.neighbors.push(message.from);
    }
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
    this.neighbors.forEach((neighbor) => {
      this.sendMessage({ ...linkState, to: neighbor });
    });
  }

  handleLSRUpdate(message) {
    const linkState = JSON.parse(message.payload);
    const existingUpdate = this.topologyMap.get(linkState.node);
    if (!existingUpdate || existingUpdate.timestamp < linkState.timestamp) {
      this.topologyMap.set(linkState.node, linkState);
      this.recalculateRoutes();

      // Forward the update to neighbors
      this.neighbors.forEach((neighbor) => {
        if (neighbor !== message.from) {
          this.sendMessage({
            ...message,
            to: neighbor,
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
    const message = {
      type: "message",
      from: this.jid,
      to: to,
      hops: 0,
      payload: payload,
      headers: [],
    };
    this.handleMessage(message);
  }
}

const node1 = new LSRNode("node1@alumchat.lol", "password1", [
  "node2@alumchat.lol",
  "node3@alumchat.lol",
]);
