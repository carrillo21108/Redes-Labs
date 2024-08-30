const { client, xml } = require("@xmpp/client");
const uuid = require("uuid");
const fs = require("fs");
const readline = require("readline");

class LRSNode {
  constructor(
    jid,
    password,
    neighbors,
    costs = {},
    mode = "lsr",
    verbose = false
  ) {
    console.log(`[DEBUG] Initializing node ${jid}`);
    this.xmpp = client({
      service: "ws://alumchat.lol:7070/ws/", // XMPP server address
      domain: "alumchat.lol",
      username: jid.split("@")[0], // Extract username from JID
      password: password, // Use provided password
    });

    this.isOnline = false; // Track online status of the node
    this.onlinePromise = new Promise((resolve) => {
      this.resolveOnlinePromise = resolve; // Resolve when online
    });

    this.jid = jid; // JID of the node
    this.neighbors = neighbors; // Direct neighbors of the node
    this.costs = costs; // Link costs to each neighbor
    this.routingTable = {}; // Routing table for shortest paths
    this.linkStateDB = { [this.jid]: this.costs }; // Database of link states
    this.messageLog = []; // Log of messages sent/received
    this.mode = mode; // Operating mode, default is LSR
    this.sequenceNumber = 0; // Sequence number for LSAs
    this.receivedMessages = new Set(); // Track received messages by ID

    this.verbose = verbose; // Verbose logging flag

    this.xmpp.on("online", this.onOnline.bind(this)); // Handle online event
    this.xmpp.on("stanza", this.onStanza.bind(this)); // Handle incoming stanzas
    this.xmpp.on("error", this.onError.bind(this)); // Handle errors
  }

  logNetworkState() {
    console.log(`\n--- Network State for ${this.jid} ---`);
    console.log("Neighbors:", this.neighbors);
    console.log("Costs:", this.costs);
    console.log("Link State DB:", this.linkStateDB);
    console.log("Routing Table:", this.routingTable);
    console.log("-----------------------------\n");
  }

  log(level, message) {
    if (this.verbose || ["IMPORTANT", "CRITICAL", "ERROR"].includes(level)) {
      console.log(`${this.jid} - ${level} - ${message}`);
      this.messageLog.push(message); // Log the message
    }
  }

  async start() {
    await this.xmpp.start(); // Start the XMPP client
  }

  async onOnline() {
    this.log("INFO", `Session started (Mode: ${this.mode})`);
    await this.xmpp.send(xml("presence")); // Send presence stanza
    this.isOnline = true; // Mark node as online
    this.resolveOnlinePromise(); // Resolve the online promise
  }

  async sendMessageTo(toJid, message) {
    if (message.type === "info") {
      await this.xmpp.send(
        xml(
          "message",
          { to: toJid, type: "chat" },
          xml("body", {}, JSON.stringify(message)) // Send LSA as JSON
        )
      );
    } else {
      const nextHop = this.getNextHop(toJid); // Determine next hop
      if (nextHop) {
        message.hops += 1; // Increment hop count
        message.headers.push({ via: this.jid }); // Add node to path
        await this.xmpp.send(
          xml(
            "message",
            { to: nextHop, type: "chat" },
            xml("body", {}, JSON.stringify(message)) // Forward message
          )
        );
        this.log("IMPORTANT", `Forwarded message to ${toJid} via ${nextHop}`);
      } else {
        this.log("ERROR", `No route to ${toJid}`);
      }
    }
  }

  async onStanza(stanza) {
    if (stanza.is("message") && stanza.getChild("body")) {
      const messageBody = JSON.parse(stanza.getChildText("body"));
      const from = stanza.attrs.from.split("/")[0]; // Get sender JID

      if (messageBody.type === "info") {
        await this.floodMessage(messageBody, from); // Handle LSA
      } else {
        this.log(
          "IMPORTANT",
          `Received a message from ${from}: ${messageBody.id}`
        );
        if (messageBody.to === this.jid) {
          this.log(
            "IMPORTANT",
            `Message reached its destination: ${messageBody.payload}`
          );
          this.log(
            "IMPORTANT",
            `Path taken: ${messageBody.headers.map((h) => h.via).join(" -> ")}`
          );
          this.log("IMPORTANT", `Number of hops: ${messageBody.hops}`);
        } else {
          await this.sendMessageTo(messageBody.to, messageBody); // Forward message
        }
      }
    }
  }

  getNextHop(destination) {
    const route = this.routingTable[destination]; // Look up route
    return route ? route[0] : null; // Return next hop or null
  }

  updateLinkStateDB(sourceJid, costs) {
    this.linkStateDB[sourceJid] = costs; // Update the link state database
    this.log("INFO", `Updated Link State DB for ${sourceJid}`);
  }

  async floodMessage(message, sender) {
    if (this.receivedMessages.has(message.id)) {
      return; // Avoid processing the same message multiple times
    }
    this.receivedMessages.add(message.id); // Mark message as received

    let parsed;
    try {
      if (typeof message.payload === "string") {
        parsed = JSON.parse(message.payload); // Parse payload as JSON
      } else {
        parsed = message.payload;
      }

      if (Array.isArray(parsed)) {
        const transformed = {}; // Transform array to object
        for (const item of parsed) {
          transformed[item.nodeJid] = item.cost; // Map node JIDs to costs
        }
        parsed = transformed;
      }
    } catch (error) {
      console.error("Error parsing payload:", error);
      return; // Exit on parsing error
    }

    this.updateLinkStateDB(message.from, parsed); // Update link state DB

    // Flood to all neighbors except the sender
    for (const neighbor of this.neighbors) {
      if (neighbor !== sender) {
        await this.sendMessageTo(neighbor, message); // Forward message to neighbor
      }
    }

    this.computeRoutingTable(); // Recompute routing table after update
  }

  async shareLinkState() {
    this.sequenceNumber += 1; // Increment sequence number

    const message = {
      type: "info", // Indicate LSA type
      from: this.jid,
      to: "all", // Broadcast to all
      hops: 0,
      headers: [],
      payload: JSON.stringify(this.costs), // Include costs in payload
      id: `ls_${this.jid}_${this.sequenceNumber}`, // Unique ID for LSA
    };

    for (const neighbor of this.neighbors) {
      await this.xmpp.send(
        xml(
          "message",
          { to: neighbor, type: "chat" },
          xml("body", {}, JSON.stringify(message)) // Send LSA to neighbors
        )
      );
    }
  }

  computeRoutingTable() {
    this.routingTable = {};

    const distances = {}; // Store shortest distances
    const previous = {}; // Store previous nodes on the path
    const nodes = new Set(); // Set of all nodes

    // Initialize distances and add all nodes to the set
    for (const node in this.linkStateDB) {
      distances[node] = node === this.jid ? 0 : Infinity; // Distance to self is 0
      previous[node] = null;
      nodes.add(node);
    }

    while (nodes.size > 0) {
      // Find the node with the minimum distance
      let minNode = null;
      for (const node of nodes) {
        if (minNode === null || distances[node] < distances[minNode]) {
          minNode = node;
        }
      }

      // Remove the minimum node from the unvisited set
      nodes.delete(minNode);

      // Update distances to neighbors
      const neighbors = this.linkStateDB[minNode] || {};
      for (const neighbor in neighbors) {
        const alt = distances[minNode] + neighbors[neighbor];
        if (alt < distances[neighbor]) {
          distances[neighbor] = alt;
          previous[neighbor] = minNode; // Track the best path
        }
      }
    }

    // Build the routing table
    for (const node in distances) {
      if (node !== this.jid) {
        let path = [];
        let current = node;
        while (current !== null) {
          path.unshift(current); // Build path in reverse
          current = previous[current];
        }
        if (path.length > 1) {
          this.routingTable[node] = [path[1], distances[node]]; // Store next hop and distance
        }
      }
    }
  }

  onError(err) {
    this.log("ERROR", `An error occurred: ${err.message}`);
  }
}

async function initializeNodesSequentially(nodeConfigs, topoData, namesData) {
  const nodes = {};
  const domain = "alumchat.lol";

  for (const config of nodeConfigs) {
    const nodeId = config.nodeId;
    const jid = namesData.config[nodeId];
    const password = config.password;
    const neighbors = topoData.config[nodeId].map((id) => namesData.config[id]);
    const costs = {};

    topoData.config[nodeId].forEach((neighborId) => {
      costs[namesData.config[neighborId]] = 1; // Assuming all links have a cost of 1
    });

    const client = new LRSNode(
      jid,
      password,
      neighbors,
      costs,
      "lsr",
      true
    );
    nodes[nodeId] = client;

    await client.start(); // Start the node's XMPP client
    console.log(`Node ${nodeId} initialized and online`);
  }

  return nodes;
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

const topoData = JSON.parse(fs.readFileSync("data/topo1-x-randomB.txt", "utf8"));
const namesData = JSON.parse(fs.readFileSync("data/names1-x-randomB.txt", "utf8"));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function question(query) {
  return new Promise(resolve => {
    rl.question(query, (answer) => {
      resolve(answer); // Resolve the promise with the user's input
    });
  });
}

async function initializeNode(nodeConfigs, topoData, namesData, selectedNodeId) {
  const filteredNodeConfig = nodeConfigs.filter(
    (config) => config.nodeId === selectedNodeId
  );
  if (filteredNodeConfig.length === 0) {
    console.log(`Node ${selectedNodeId} not found.`);
    return;
  }

  const nodes = await initializeNodesSequentially(filteredNodeConfig, topoData, namesData);

  await question("Press any key when all nodes are connected... ");
  console.log("Starting LSR propagation...");
  await nodes[selectedNodeId].shareLinkState();

  console.log("Loading... ");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  nodes[selectedNodeId].logNetworkState();

  const role = await question("Enter the role (sender/receiver): ");

  if (role === "sender") {
    const destinationNodeId = await question("Enter the destination Node ID: ");
    const message = await question("Enter the message: ");

    nodes[selectedNodeId].sendMessageTo(namesData.config[destinationNodeId], {
      type: "chat",
      from: namesData.config[selectedNodeId],
      to: namesData.config[destinationNodeId],
      payload: message,
      hops: 0,
      headers: [],
    });
  } else {
    console.log("Waiting for messages...");
  }
}

async function waitForNodeSelection() {
  const nodeId = await question("Enter the Node ID to initialize: ");
  await initializeNode(nodeConfigs, topoData, namesData, nodeId);
  rl.close();
}

waitForNodeSelection();
