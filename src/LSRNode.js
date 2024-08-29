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
      service: "ws://alumchat.lol:7070/ws/",
      domain: "alumchat.lol",
      username: jid.split("@")[0],
      password: password,
    });

    this.isOnline = false;
    this.onlinePromise = new Promise((resolve) => {
      this.resolveOnlinePromise = resolve;
    });

    this.jid = jid;
    this.neighbors = neighbors;
    this.costs = costs;
    this.routingTable = {};
    this.linkStateDB = { [this.jid]: this.costs };
    this.messageLog = [];
    this.mode = mode;
    this.sequenceNumber = 0;
    this.receivedMessages = new Set();

    this.verbose = verbose;

    this.xmpp.on("online", this.onOnline.bind(this));
    this.xmpp.on("stanza", this.onStanza.bind(this));
    this.xmpp.on("error", this.onError.bind(this));
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
      this.messageLog.push(message);
    }
  }

  async start() {
    await this.xmpp.start();
  }
  async onOnline() {
    this.log("INFO", `Session started (Mode: ${this.mode})`);
    await this.xmpp.send(xml("presence"));
    this.isOnline = true;
    this.resolveOnlinePromise();
  }
  async sendMessageTo(toJid, message) {
    if (message.type === "info") {
      await this.xmpp.send(
        xml(
          "message",
          { to: toJid, type: "chat" },
          xml("body", {}, JSON.stringify(message))
        )
      );
    } else {
      const nextHop = this.getNextHop(toJid);
      if (nextHop) {
        message.hops += 1;
        message.headers.push({ via: this.jid });
        await this.xmpp.send(
          xml(
            "message",
            { to: nextHop, type: "chat" },
            xml("body", {}, JSON.stringify(message))
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
      const from = stanza.attrs.from.split("/")[0];

      if (messageBody.type === "info") {
        await this.floodMessage(messageBody, from);
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
          await this.sendMessageTo(messageBody.to, messageBody);
        }
      }
    }
  }

  getNextHop(destination) {
    const route = this.routingTable[destination];
    return route ? route[0] : null;
  }

  updateLinkStateDB(sourceJid, costs) {
    this.linkStateDB[sourceJid] = costs;
    this.log("INFO", `Updated Link State DB for ${sourceJid}`);
  }

  async floodMessage(message, sender) {
    if (this.receivedMessages.has(message.id)) {
      return;
    }
    this.receivedMessages.add(message.id);

    let parsed;
    try {
      if (typeof message.payload === "string") {
        parsed = JSON.parse(message.payload);
      } else {
        parsed = message.payload;
      }

      if (Array.isArray(parsed)) {
        const transformed = {};
        for (const item of parsed) {
          transformed[item.nodeJid] = item.cost;
        }
        parsed = transformed;
      }
    } catch (error) {
      console.error("Error parsing payload:", error);
      return;
    }

    this.updateLinkStateDB(message.from, parsed);

    // Flood to all neighbors except the sender
    for (const neighbor of this.neighbors) {
      if (neighbor !== sender) {
        await this.sendMessageTo(neighbor, message);
      }
    }

    this.computeRoutingTable();
  }

  async shareLinkState() {
    this.sequenceNumber += 1;

    const message = {
      type: "info",
      from: this.jid,
      to: "all",
      hops: 0,
      headers: [],
      payload: JSON.stringify(this.costs),
      id: `ls_${this.jid}_${this.sequenceNumber}`,
    };

    for (const neighbor of this.neighbors) {
      await this.xmpp.send(
        xml(
          "message",
          { to: neighbor, type: "chat" },
          xml("body", {}, JSON.stringify(message))
        )
      );
    }
  }

  computeRoutingTable() {
    this.routingTable = {};

    const distances = {};
    const previous = {};
    const nodes = new Set();

    // Initialize distances and add all nodes to the set
    for (const node in this.linkStateDB) {
      distances[node] = node === this.jid ? 0 : Infinity;
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
          previous[neighbor] = minNode;
        }
      }
    }

    // Build the routing table
    for (const node in distances) {
      if (node !== this.jid) {
        let path = [];
        let current = node;
        while (current !== null) {
          path.unshift(current);
          current = previous[current];
        }
        if (path.length > 1) {
          this.routingTable[node] = [path[1], distances[node]];
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

    await client.start();
    console.log(`Node ${nodeId} initialized and online`);
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

const topoData = JSON.parse(fs.readFileSync("data/topo-1.txt", "utf8"));
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