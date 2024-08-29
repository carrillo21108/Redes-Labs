# Flooding and Link State Routing (LSR)

## Prerequisites

Before you begin, ensure you have met the following requirements:

* You have installed [Node.js](https://nodejs.org/) (version 12.0 or later)

## Prerequisites

Before you begin, ensure you have met the following requirements:

* You have installed [Node.js](https://nodejs.org/) (version 12.0 or later)
* You have a basic understanding of networking concepts

## Installing the Project

To install the project, follow these steps:

1. Clone the repository
   ```
   git clone https://github.com/carrillo21108/Redes-Labs.git
   ```
2. Navigate to the project directory
   ```
   cd networking-algorithms
   ```
3. Switch to the Lab03 branch
   ```
   git checkout Lab03
   ```
4. Install the dependencies
   ```
   npm install
   ```

## Running the Algorithms

This project includes two algorithms: Flooding and Link State Routing (LSR). You can run either algorithm using the following commands:

### Flooding Algorithm

To run the Flooding algorithm:

```
npm run flooding
```

### Link State Routing (LSR) Algorithm

To run the Link State Routing algorithm:

```
npm run lsr
```

## How to Use

After starting either algorithm, follow the prompts in the console. The process will be slightly different for each algorithm:

### For Flooding:

1. Enter the Node ID to initialize
2. Press any key when all nodes are connected
3. Enter a destination Node ID
4. Enter a message to send

### For Link State Routing (LSR):

1. Enter the Node ID to initialize
2. **Important:** Wait for all nodes to be connected. This may take a moment.
3. Once all nodes are connected, press any key to start the routing algorithm
4. The LSR propagation will begin, and you'll see a "Loading..." message
5. After the routing tables have stabilized, you'll be prompted to:
   - Enter a destination Node ID
   - Enter a message to send

The program will then simulate the chosen algorithm and display the results.

Note: For the LSR algorithm, it's crucial to ensure all nodes are connected before starting the routing process. This allows the algorithm to correctly build its routing tables based on the complete network topology.king concepts

## Installing the Project

To install the project, follow these steps:

1. Clone the repository
   ```
   git clone https://github.com/yourusername/networking-algorithms.git
   ```
2. Navigate to the project directory
   ```
   cd src
   ```
3. Install the dependencies
   ```
   npm install
   ```

## Running the Algorithms

This project includes two algorithms: Flooding and Link State Routing (LSR). You can run either algorithm using the following commands:

### Flooding Algorithm

To run the Flooding algorithm:

```
npm run flooding
```

### Link State Routing (LSR) Algorithm

To run the Link State Routing algorithm:

```
npm run lsr
```

## How to Use

After starting either algorithm, follow the prompts in the console. The process will be slightly different for each algorithm:

### For Flooding:

1. Enter the Node ID to initialize
2. Press any key when all nodes are connected
3. Enter a destination Node ID
4. Enter a message to send

### For Link State Routing (LSR):

1. Enter the Node ID to initialize
2. **Important:** Wait for all nodes to be connected. This may take a moment.
3. Once all nodes are connected, press any key to start the routing algorithm
4. The LSR propagation will begin, and you'll see a "Loading..." message
5. After the routing tables have stabilized, you'll be prompted to:
   - Enter a destination Node ID
   - Enter a message to send

The program will then simulate the chosen algorithm and display the results.

Note: For the LSR algorithm, it's crucial to ensure all nodes are connected before starting the routing process. This allows the algorithm to correctly build its routing tables based on the complete network topology.
