const XMPP = require("simple-xmpp");

class FloodingNode {
  constructor(jid, password, neighbors) {
    this.jid = jid;
    this.password = password;
    this.neighbors = neighbors;
    this.xmpp = new XMPP();
    this.messagesSeen = new Set();

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
      // Add more message types as needed
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
      this.floodMessage(message);
    }
  }

  floodMessage(message) {
    this.neighbors.forEach((neighbor) => {
      if (neighbor !== message.from) {
        const forwardedMessage = { ...message, hops: message.hops + 1 };
        this.sendMessage(forwardedMessage);
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

const node1 = new FloodingNode("node1@alumchat.lol", "password1", [
  "node2@alumchat.lol",
  "node3@alumchat.lol",
]);
