const { client, xml } = require("@xmpp/client");
const fs = require("fs");
const readline = require("readline");

class FloodingNode {
  constructor(nodeId, password) {
    this.nodeId = nodeId;
    this.password = password;
    this.jid = null;
    this.neighbors = [];
    this.xmpp = null;
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
  }

  async sendMessage(message, immediateRecipient) {
    const stanza = xml(
      "message",
      { to: immediateRecipient, from: this.jid, type: "chat" },
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
    const messageId = `${message.type}-${message.from}-${message.to}-${message.payload}`;
    ``;
    if (this.messagesSeen.has(messageId)) {
      return;
    }
    this.messagesSeen.add(messageId);

    switch (message.type) {
      case "hello":
        this.handleHello(message);
        break;
      case "message":
        this.handleChatMessage(message, from);
        break;
    }
  }

  handleHello(message) {
    console.log(
      `[DEBUG] Node ${this.nodeId} received hello from ${message.from}`
    );
  }

  handleChatMessage(message, from) {
    if (message.to === this.jid) {
      console.log("Message received:", message.payload);
      console.log("Body:", JSON.stringify(message));
    } else {
      this.floodMessage(message, from);
    }
  }

  floodMessage(message, from) {
    this.neighbors.forEach((neighborJid) => {
      if (neighborJid !== from) {
        const forwardedMessage = {
          ...message,
          hops: (message.hops || 0) + 1,
        };

        this.sendMessage(forwardedMessage, neighborJid);
      }
    });
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

// Function to initialize nodes sequentially
async function initializeNodesSequentially(nodeConfigs) {
  const nodes = {};
  for (const config of nodeConfigs) {

    const node = new FloodingNode(
      config.nodeId,
      config.password
    );

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

const namesData = JSON.parse(fs.readFileSync("data/names-1.txt", "utf8"));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function question(query) {
  return new Promise(resolve => {
    rl.question(query, (answer) => {
      resolve(answer);
    });
  });
}

async function initializeNode(nodeConfigs, selectedNodeId) {
  const filteredNodeConfig = nodeConfigs.filter(
    (config) => config.nodeId === selectedNodeId
  );
  if (filteredNodeConfig.length === 0) {
    console.log(`Node ${selectedNodeId} not found.`);
    return;
  }

  const nodes = await initializeNodesSequentially(filteredNodeConfig);

  const role = await question("Enter the role (sender/receiver): ");

  if (role === "sender") {
    const destinationNodeId = await question("Enter the destination Node ID: ");
    const message = await question("Enter the message: ");

    nodes[selectedNodeId].sendChatMessage(
      namesData.config[destinationNodeId],
      message
    );
  } else {
    console.log("Waiting for messages... ");
  }
}

async function waitForNodeSelection() {
  const nodeId = await question("Enter the Node ID to initialize: ");
  await initializeNode(nodeConfigs, nodeId);
  rl.close();
}

waitForNodeSelection();