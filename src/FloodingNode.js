const { client, xml } = require("@xmpp/client");
const fs = require("fs");
const readline = require("readline");

class FloodingNode {
  constructor(nodeId, password) {
    this.nodeId = nodeId;
    this.password = password;
    this.jid = null; // JID will be set in loadConfigurations
    this.neighbors = []; // List of neighbor JIDs
    this.xmpp = null; // XMPP client instance
    this.messagesSeen = new Set(); // Track seen messages to prevent loops
    this.onlinePromise = new Promise((resolve) => {
      this.resolveOnline = resolve; // Resolve when the node is online
    });

    this.loadConfigurations();
    this.setupXMPP();
  }

  loadConfigurations() {
    const topoData = JSON.parse(fs.readFileSync("data/topo1-x-randomB-2024.txt", "utf8"));
    const namesData = JSON.parse(fs.readFileSync("data/names1-x-randomB-2024.txt", "utf8"));

    if (topoData.type !== "topo" || !topoData.config[this.nodeId]) {
      throw new Error("Invalid topology configuration or node not found");
    }
    if (namesData.type !== "names" || !namesData.config[this.nodeId]) {
      throw new Error("Invalid names configuration or node not found");
    }

    this.jid = namesData.config[this.nodeId]; // Set the JID for this node

    // Convert neighbor node IDs to JIDs
    this.neighbors = topoData.config[this.nodeId].map((neighborId) => {
      const neighborJid = namesData.config[neighborId];
      if (!neighborJid) {
        throw new Error(`No JID found for neighbor node ${neighborId}`);
      }
      return neighborJid; // Add neighbor JID to the list
    });

    console.log(`[DEBUG] Node ${this.nodeId} configured with JID ${this.jid}`);
    console.log(`[DEBUG] Neighbors: ${this.neighbors.join(", ")}`);
  }

  setupXMPP() {
    const [username, domain] = this.jid.split("@");
    this.xmpp = client({
      service: `ws://${domain}:7070/ws/`, // XMPP WebSocket service URL
      domain: domain,
      username: username, // XMPP username derived from JID
      password: this.password, // Password for authentication
    });

    this.xmpp.on("online", this.onConnect.bind(this)); // Handle connection
    this.xmpp.on("stanza", this.onStanza.bind(this)); // Handle incoming stanzas
    this.xmpp.on("error", (err) => console.error("[ERROR] XMPP error:", err)); // Handle errors

    this.xmpp.start().catch(console.error); // Start the XMPP client
  }

  async onConnect(address) {
    await this.xmpp.send(xml("presence")); // Announce presence
    this.resolveOnline(); // Resolve the online promise
  }

  async sendMessage(message, immediateRecipient) {
    const stanza = xml(
      "message",
      { to: immediateRecipient, from: this.jid, type: "chat" }, // Construct XMPP message stanza
      xml("body", {}, JSON.stringify(message)) // Attach the message payload
    );

    await this.xmpp.send(stanza); // Send the stanza
  }

  onStanza(stanza) {
    if (stanza.is("message") && stanza.attrs.type === "chat") {
      const body = stanza.getChild("body");
      if (body) {
        const message = JSON.parse(body.text()); // Parse the incoming message

        this.handleMessage(message, stanza.attrs.from); // Handle the message
      }
    }
  }

  handleMessage(message, from) {
    const messageId = `${message.type}-${message.from}-${message.to}-${message.payload}`;
    if (this.messagesSeen.has(messageId)) {
      return; // Ignore duplicate messages
    }
    this.messagesSeen.add(messageId); // Mark the message as seen

    switch (message.type) {
      case "hello":
        this.handleHello(message); // Handle hello messages
        break;
      case "message":
        this.handleChatMessage(message, from); // Handle chat messages
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
      console.log("Message received:", message.payload); // Display the message
      console.log("Body:", JSON.stringify(message));
    } else {
      console.log("Forwarding message:", message.payload); // Display the message
      this.floodMessage(message, from); // Forward the message to neighbors
    }
  }

  floodMessage(message, from) {
    this.neighbors.forEach((neighborJid) => {
      if (neighborJid !== from) {
        const forwardedMessage = {
          ...message,
          hops: (message.hops || 0) + 1, // Increment the hop count
        };

        this.sendMessage(forwardedMessage, neighborJid); // Send to neighbor
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

    this.handleMessage(message); // Process and flood the message
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

    await node.onlinePromise; // Wait until the node is online
    nodes[config.nodeId] = node; // Store the initialized node
  }
  return nodes; // Return the initialized nodes
}

// Usage
const password = "prueba2024";
const nodeConfigs = [
  { nodeId: "A", password },
  { nodeId: "B", password },
  { nodeId: "C", password },
  { nodeId: "D", password },
  { nodeId: "E", password },
  { nodeId: "F", password },
];

const namesData = JSON.parse(fs.readFileSync("data/names1-x-randomB-2024.txt", "utf8"));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function question(query) {
  return new Promise(resolve => {
    rl.question(query, (answer) => {
      resolve(answer); // Resolve with user's input
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
