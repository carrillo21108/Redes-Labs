const { client, xml } = require("@xmpp/client");
const fs = require("fs");

class LinkStateNode {
  constructor(nodeId, password) {
    this.nodeId = nodeId;
    this.password = password;
    this.jid = null;
    this.neighbors = [];
    this.xmpp = null;
    this.messagesSeen = new Set();
    this.networkTopology = {};
    this.sequenceNumber = 0;
    this.onlinePromise = new Promise((resolve) => {
      this.resolveOnline = resolve;
    });

    this.loadConfigurations();
    this.setupXMPP();
    this.startPeriodicBroadcast();
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

    // Convert neighbor node IDs to JIDs
    this.neighbors = topoData.config[this.nodeId].map((neighborId) => {
      const neighborJid = namesData.config[neighborId];
      if (!neighborJid) {
        throw new Error(`No JID found for neighbor node ${neighborId}`);
      }
      return neighborJid;
    });

    console.log(`[DEBUG] Node ${this.nodeId} configured with JID ${this.jid}`);
    console.log(`[DEBUG] Neighbors: ${this.neighbors.join(", ")}`);
  }

  startPeriodicBroadcast() {
    setInterval(() => {
      this.broadcastLinkState();
    }, 2000); // Broadcast every 30 seconds
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
    this.broadcastLinkState();
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
    if (stanza.is("message") && stanza.attrs.type === "chat") {
      const body = stanza.getChild("body");
      if (body) {
        const message = JSON.parse(body.text());
        this.handleMessage(message, stanza.attrs.from);
      }
    }
  }

  handleMessage(message, from) {
    const messageId = `${message.type}-${message.from}-${message.sequenceNumber}`;
    if (this.messagesSeen.has(messageId)) {
      return;
    }
    this.messagesSeen.add(messageId);

    switch (message.type) {
      case "info":
        this.handleLinkState(message);
        break;
      case "chat":
        this.handleChatMessage(message, from);
        break;
    }
  }

  handleLinkState(message) {
    console.log(
      `[DEBUG] Node ${this.nodeId} received link state from ${message.from}`
    );

    // Update network topology
    this.networkTopology[message.from] = message.neighbors;

    // Rebroadcast to neighbors
    this.neighbors.forEach((neighbor) => {
      if (neighbor !== message.from) {
        this.sendMessage(message, neighbor);
      }
    });

    // Recalculate shortest paths
    this.calculateShortestPaths();
  }

  handleChatMessage(message, from) {
    if (message.to === this.jid) {
      console.log("Message received:", message.payload);
      console.log("Body:", JSON.stringify(message));
    } else {
      this.forwardMessage(message);
    }
  }

  forwardMessage(message) {
    const nextHop = this.getNextHop(message.to);
    if (nextHop) {
      this.sendMessage(message, nextHop);
    } else {
      console.log(`[ERROR] No route to ${message.to}`);
    }
  }

  broadcastLinkState() {
    const linkStateMessage = {
      type: "info",
      from: this.jid,
      neighbors: this.neighbors,
      sequenceNumber: this.sequenceNumber++,
    };

    this.neighbors.forEach((neighbor) => {
      this.sendMessage(linkStateMessage, neighbor);
    });
  }

  calculateShortestPaths() {
    // Implement Dijkstra's algorithm here
    // This is a simplified version and should be expanded for production use
    this.shortestPaths = {};
    const nodes = Object.keys(this.networkTopology);

    nodes.forEach((node) => {
      if (node !== this.jid) {
        let shortestDistance = Infinity;
        let nextHop = null;

        this.neighbors.forEach((neighbor) => {
          if (
            this.networkTopology[neighbor] &&
            this.networkTopology[neighbor].includes(node)
          ) {
            shortestDistance = 2;
            nextHop = neighbor;
          }
        });

        if (this.neighbors.includes(node)) {
          shortestDistance = 1;
          nextHop = node;
        }

        this.shortestPaths[node] = {
          distance: shortestDistance,
          nextHop: nextHop,
        };
      }
    });

    console.log(
      `[DEBUG] Node ${this.nodeId} updated shortest paths:`,
      this.shortestPaths
    );
  }

  getNextHop(destination) {
    return this.shortestPaths[destination]
      ? this.shortestPaths[destination].nextHop
      : null;
  }

  sendChatMessage(to, payload) {
    const message = {
      type: "chat",
      from: this.jid,
      to: to,
      payload: payload,
    };

    this.handleMessage(message, this.jid);
  }
}

// Function to initialize nodes sequentially
async function initializeNodesSequentially(nodeConfigs) {
  const nodes = {};
  for (const config of nodeConfigs) {
    const node = new LinkStateNode(config.nodeId, config.password);
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
  // Give some time for link state messages to propagate
  setTimeout(() => {
    // Simulate sending a message from node A to node H
    nodes["A"].sendChatMessage(
      "bca_h@alumchat.lol",
      "Hello from Node A to Node H!"
    );
  }, 5000);
});
