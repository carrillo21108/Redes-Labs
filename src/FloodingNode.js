const XMPP = require("simple-xmpp");
const fs = require("fs");

class FloodingNode {
  constructor(nodeId, password) {
    this.nodeId = nodeId;
    this.password = password;
    this.jid = null;
    this.neighbors = [];
    this.xmpp = new XMPP();
    this.messagesSeen = new Set();

    this.loadConfigurations();
    this.setupXMPP();
  }

  loadConfigurations() {
    const topoData = JSON.parse(fs.readFileSync("topo-flood.txt", "utf8"));
    if (topoData.type !== "topo" || !topoData.config[this.nodeId]) {
      throw new Error("Invalid topology configuration or node not found");
    }
    this.neighbors = topoData.config[this.nodeId].map(String);

    const namesData = JSON.parse(fs.readFileSync("names-flood.txt", "utf8"));
    if (namesData.type !== "names" || !namesData.config[this.nodeId]) {
      throw new Error("Invalid names configuration or node not found");
    }
    this.jid = namesData.config[this.nodeId];

    console.log(`Node ${this.nodeId} configured with JID ${this.jid}`);
    console.log(`Neighbors: ${this.neighbors.join(", ")}`);
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
    });

    this.xmpp.on("chat", (from, message) => {
      this.handleMessage(JSON.parse(message));
    });
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
    }
  }

  handleHello(message) {
    console.log(`Received hello from ${message.from}`);
  }

  handleChatMessage(message) {
    if (message.to === this.jid) {
      console.log(`Message for me: ${message.payload}`);
    } else {
      this.floodMessage(message);
    }
  }

  floodMessage(message) {
    this.neighbors.forEach((neighborId) => {
      const neighborJid = this.resolveJid(neighborId);
      if (neighborJid && neighborJid !== message.from) {
        const forwardedMessage = { ...message, hops: message.hops + 1 };
        this.sendMessage({ ...forwardedMessage, to: neighborJid });
      }
    });
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

const node = new FloodingNode("A", "passwordA");
