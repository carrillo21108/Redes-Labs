const { client, xml } = require("@xmpp/client");
const fs = require("fs");

class LSRNode {
  constructor(nodeId, password) {
    this.nodeId = nodeId;
    this.password = password;
    this.jid = null;
    this.neighbors = {};
    this.xmpp = null;
    this.linkStateDB = {};
    this.routingTable = {};
    this.sequenceNumber = 0;
    this.messagesSeen = new Set();
    this.onlinePromise = new Promise((resolve) => {
      this.resolveOnline = resolve;
    });

    this.loadConfigurations();
    this.setupXMPP();
  }

  loadConfigurations() {
    const topoData = JSON.parse(fs.readFileSync("data/topo-1.txt", "utf8"));
    const namesData = JSON.parse(fs.readFileSync("data/names-1.txt", "utf8"));

    if (topoData.type !== "topo" || !topoData.config[this.nodeId]) {
      throw new Error("Invalid topology configuration or node not found");
    }
    if (namesData.type !== "names" || !namesData.config[this.nodeId]) {
      throw new Error("Invalid names configuration or node not found");
    }

    this.jid = namesData.config[this.nodeId];

    // Convert neighbor node IDs to JIDs and assign costs
    topoData.config[this.nodeId].forEach((neighborId) => {
      const neighborJid = namesData.config[neighborId];
      if (!neighborJid) {
        throw new Error(`No JID found for neighbor node ${neighborId}`);
      }
      this.neighbors[neighborJid] = 1; // Assigning a default cost of 1
    });

    console.log(`[DEBUG] Node ${this.nodeId} configured with JID ${this.jid}`);
    console.log(`[DEBUG] Neighbors: ${Object.keys(this.neighbors).join(", ")}`);
  }

  setupXMPP() {
    const [username, domain] = this.jid.split("@");
    this.xmpp = client({
      service: `ws://${domain}:7070/ws/`,
      domain: domain,
      username: username,
      password: this.password,
    });

    this.xmpp.on("online", this.onConnect.bind(this));
    this.xmpp.on("stanza", this.onStanza.bind(this));
    this.xmpp.on("error", (err) => console.error("[ERROR] XMPP error:", err));

    this.xmpp.start().catch(console.error);
  }

  async onConnect(address) {
    await this.xmpp.send(xml("presence"));
    this.resolveOnline();
    this.schedulePeriodicTasks();
  }

  async sendMessage(message, recipient) {
    const stanza = xml(
      "message",
      { to: recipient, from: this.jid, type: "chat" },
      xml("body", {}, JSON.stringify(message))
    );

    await this.xmpp.send(stanza);
  }

  onStanza(stanza) {
    console.log("[DEBUG] Received stanza:", stanza.toString());
    if (stanza.is("message") && stanza.attrs.type === "chat") {
      const body = stanza.getChild("body");
      if (body) {
        const message = JSON.parse(body.text());
        this.handleMessage(message, stanza.attrs.from);
      }
    }
  }

  handleMessage(message, from) {
    const messageId = `${message.type}-${message.from}-${message.to}-${message.payload}`;
    if (this.messagesSeen.has(messageId)) {
      return;
    }
    this.messagesSeen.add(messageId);

    switch (message.type) {
      case "echo":
        this.handleEcho(message);
        break;
      case "info":
        this.handleLinkStateUpdate(message);
        break;
      case "message":
        this.handleChatMessage(message, from);
        break;
    }
  }

  handleEcho(message) {
    if (message.to === this.jid) {
      const rtt = Date.now() - parseFloat(message.payload);
      console.log(
        `[DEBUG] ECHO reply from ${message.from}, RTT: ${rtt.toFixed(3)} ms`
      );
    } else {
      this.sendMessage(message, message.to);
    }
  }

  handleLinkStateUpdate(message) {
    const linkState = JSON.parse(message.payload);
    this.linkStateDB[message.from] = linkState;
    this.computeRoutingTable();
    this.floodLinkState(message);
  }

  handleChatMessage(message, from) {
    if (message.to === this.jid) {
      console.log("Message received:", message.payload);
      console.log("Body:", JSON.stringify(message));
    } else {
      this.forwardMessage(message);
    }
  }

  floodLinkState(message) {
    Object.keys(this.neighbors).forEach((neighborJid) => {
      if (neighborJid !== message.from) {
        this.sendMessage(message, neighborJid);
      }
    });
  }

  forwardMessage(message) {
    const nextHop = this.getNextHop(message.to);
    if (nextHop) {
      message.hops = (message.hops || 0) + 1;
      message.headers.push({ via: this.jid });
      this.sendMessage(message, nextHop);
      console.log(`[DEBUG] Forwarded message to ${message.to} via ${nextHop}`);
    } else {
      console.log(`[ERROR] No route to ${message.to}`);
    }
  }

  getNextHop(destination) {
    return this.routingTable[destination]
      ? this.routingTable[destination][0]
      : null;
  }

  computeRoutingTable() {
    const distances = {};
    const previousNodes = {};
    const unvisited = new Set();

    // Initialize distances
    Object.keys(this.linkStateDB).forEach((node) => {
      distances[node] = Infinity;
      unvisited.add(node);
    });
    distances[this.jid] = 0;

    while (unvisited.size > 0) {
      const current = Array.from(unvisited).reduce((a, b) =>
        distances[a] < distances[b] ? a : b
      );

      unvisited.delete(current);

      Object.entries(this.linkStateDB[current] || {}).forEach(
        ([neighbor, cost]) => {
          const altDistance = distances[current] + cost;
          if (altDistance < distances[neighbor]) {
            distances[neighbor] = altDistance;
            previousNodes[neighbor] = current;
          }
        }
      );
    }

    // Build routing table
    this.routingTable = {};
    Object.keys(distances).forEach((node) => {
      if (node !== this.jid) {
        let path = [];
        let current = node;
        while (current !== this.jid) {
          path.unshift(current);
          current = previousNodes[current];
        }
        this.routingTable[node] = [path[0], distances[node]];
      }
    });

    console.log("[DEBUG] Updated routing table:", this.routingTable);
  }

  shareLinkState() {
    this.sequenceNumber++;
    const message = {
      type: "info",
      from: this.jid,
      to: "all",
      hops: 0,
      headers: [],
      payload: JSON.stringify(this.neighbors),
      id: `ls_${this.jid}_${this.sequenceNumber}`,
    };

    Object.keys(this.neighbors).forEach((neighborJid) => {
      this.sendMessage(message, neighborJid);
    });
    console.log("[DEBUG] Shared link state");
  }

  schedulePeriodicTasks() {
    setInterval(() => {
      this.shareLinkState();
    }, 30000); // Share link state every 30 seconds
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

    this.handleMessage(message, this.jid);
  }
}

// Function to initialize nodes sequentially
async function initializeNodesSequentially(nodeConfigs) {
  const nodes = {};
  for (const config of nodeConfigs) {
    const node = new LSRNode(config.nodeId, config.password);
    await node.onlinePromise;
    nodes[config.nodeId] = node;
  }
  return nodes;
}

// Usage
const nodeConfigs = [
  { nodeId: "A", password: "prueba2024" },
  { nodeId: "B", password: "prueba2024" },
  { nodeId: "C", password: "prueba2024" },
  { nodeId: "D", password: "prueba2024" },
  { nodeId: "E", password: "prueba2024" },
  { nodeId: "F", password: "prueba2024" },
  { nodeId: "G", password: "prueba2024" },
  { nodeId: "H", password: "prueba2024" },
  { nodeId: "I", password: "prueba2024" },
];

initializeNodesSequentially(nodeConfigs).then((nodes) => {
  // Wait for the network to stabilize before sending messages
  setTimeout(() => {
    // Simulate sending a message from node A to node H
    nodes["A"].sendChatMessage(
      "bca_h@alumchat.lol",
      "Hello from Node A to Node H!"
    );
  }, 15000); // Wait for 60 seconds
});
