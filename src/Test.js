const { client, xml } = require("@xmpp/client");
const uuid = require("uuid");
const fs = require("fs");

class NetworkClient {
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

    this.jid = jid;
    this.neighbors = neighbors;
    this.costs = costs;
    this.routingTable = {};
    this.linkStateDB = { [this.jid]: this.costs };
    this.receivedMessages = {};
    this.messageLog = [];
    this.mode = mode;
    this.sequenceNumber = 0;
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
    await this.discoverNeighbors();
    if (this.mode === "lsr") {
      await this.shareLinkState();
    }
  }

  async discoverNeighbors() {
    for (const neighbor of this.neighbors) {
      await this.sendEcho(neighbor);
    }
  }

  async sendEcho(toJid) {
    const message = {
      type: "echo",
      from: this.jid,
      to: toJid,
      hops: 0,
      headers: [],
      payload: Date.now().toString(),
      id: uuid.v4(),
    };
    await this.sendMessageTo(toJid, JSON.stringify(message));
  }

  async sendMessageTo(toJid, message) {
    if (typeof message === "string") {
      message = JSON.parse(message);
    }

    if (!message.id) {
      message.id = uuid.v4();
    }

    if (["echo", "info"].includes(message.type)) {
      await this.xmpp.send(
        xml(
          "message",
          { to: toJid, type: "chat" },
          xml("body", {}, JSON.stringify(message))
        )
      );
      this.log("INFO", `Sent a ${message.type} message to ${toJid}`);
    } else {
      if (this.mode === "lsr") {
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
      } else if (this.mode === "flooding") {
        this.log("IMPORTANT", `Initiating flood for message: ${message.id}`);
        await this.floodMessage(message, this.jid);
      }
    }
  }

  async onStanza(stanza) {
    if (stanza.is("message") && stanza.getChild("body")) {
      const messageBody = JSON.parse(stanza.getChildText("body"));
      const from = stanza.attrs.from.split("/")[0];

      if (messageBody.type === "info") {
        this.linkStateDB[messageBody.from] = JSON.parse(messageBody.payload);
        this.computeRoutingTable();
        await this.floodMessage(messageBody, from);
        // this.logNetworkState();
      } else if (messageBody.type === "echo") {
        this.handleEcho(messageBody);
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
          if (this.mode === "flooding") {
            await this.floodMessage(messageBody, from);
          } else {
            await this.sendMessageTo(messageBody.to, messageBody);
          }
        }
      }
    }
  }

  getNextHop(destination) {
    const route = this.routingTable[destination];
    return route ? route[0] : null;
  }

  async floodMessage(message, sender) {
    if (!this.receivedMessages[message.id]) {
      this.receivedMessages[message.id] = Date.now();
      this.log("INFO", `Received flood message: ${message.id}`);

      if (!message || !message.headers) return;

      if (!message.headers.some((header) => header.via === this.jid)) {
        message.hops += 1;
        message.headers.push({ via: this.jid });

        for (const neighbor of this.neighbors) {
          if (
            neighbor !== sender &&
            !message.headers.some((header) => header.via === neighbor)
          ) {
            await this.xmpp.send(
              xml(
                "message",
                { to: neighbor, type: "chat" },
                xml("body", {}, JSON.stringify(message))
              )
            );
            this.log("INFO", `Forwarded flood message to ${neighbor}`);
          }
        }
      } else {
        this.log(
          "IMPORTANT",
          `Stopping flood: node ${this.jid} already in path`
        );
      }
    }
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
      await this.sendMessageTo(neighbor, message);
    }
    // this.log("INFO", `Shared link state: ${JSON.stringify(this.costs)}`);
    // this.logNetworkState();
  }

  computeRoutingTable() {
    this.log("INFO", "Computing routing table");
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

    // this.log(
    //   "INFO",
    //   `Link State Database: ${JSON.stringify(this.linkStateDB)}`
    // );
    // this.log(
    //   "INFO",
    //   `Computed Routing Table: ${JSON.stringify(this.routingTable)}`
    // );
  }

  handleEcho(message) {
    if (message.to === this.jid) {
      const rtt = Date.now() - parseInt(message.payload);
      this.log("INFO", `ECHO reply from ${message.from}, RTT: ${rtt} ms`);
    } else {
      this.sendMessageTo(message.to, message);
    }
  }

  schedulePeriodicTasks() {
    setInterval(() => {
      if (this.mode === "lsr") {
        this.shareLinkState();
      }
    }, 30000); // Share link state every 30 seconds
  }

  onError(err) {
    this.log("ERROR", `An error occurred: ${err.message}`);
  }
}

function initializeNodesSequentially(nodeConfigs, topoData, namesData) {
  const nodes = {};
  const domain = "alumchat.lol";

  return nodeConfigs.reduce((promise, config) => {
    return promise.then(() => {
      const nodeId = config.nodeId;
      const jid = namesData.config[nodeId];
      const password = config.password;
      const neighbors = topoData.config[nodeId].map(
        (id) => namesData.config[id]
      );
      const costs = {};

      topoData.config[nodeId].forEach((neighborId) => {
        costs[namesData.config[neighborId]] = 1; // Assuming all links have a cost of 1
      });

      const client = new NetworkClient(
        jid,
        password,
        neighbors,
        costs,
        "lsr",
        true
      );
      nodes[nodeId] = client;

      return client.start().then(() => {
        console.log(`Node ${nodeId} initialized`);
        return nodes;
      });
    });
  }, Promise.resolve());
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

const topoData = {
  type: "topo",
  config: {
    A: ["B", "I", "C"],
    B: ["A", "F"],
    C: ["A", "D"],
    D: ["I", "C", "E", "F"],
    E: ["D", "G"],
    F: ["B", "D", "G", "H"],
    G: ["F", "E"],
    H: ["F"],
    I: ["A", "D"],
  },
};

const namesData = {
  type: "names",
  config: {
    A: "bca_a@alumchat.lol",
    B: "bca_b@alumchat.lol",
    C: "bca_c@alumchat.lol",
    D: "bca_d@alumchat.lol",
    E: "bca_e@alumchat.lol",
    F: "bca_f@alumchat.lol",
    G: "bca_g@alumchat.lol",
    H: "bca_h@alumchat.lol",
    I: "bca_i@alumchat.lol",
  },
};

initializeNodesSequentially(nodeConfigs, topoData, namesData).then((nodes) => {
  // Wait for the network to stabilize before sending messages
  setTimeout(() => {
    for (const nodeId in nodes) {
      nodes[nodeId].logNetworkState();
    }

    // Simulate sending a message from node A to node H
    nodes["A"].sendMessageTo(
      "bca_f@alumchat.lol",
      JSON.stringify({
        type: "chat",
        from: "bca_h@alumchat.lol",
        to: "bca_f@alumchat.lol",
        payload: "Hello from Node B to Node G!",
        hops: 0,
        headers: [],
      })
    );
  }, 10000); // Wait for 15 seconds
});
