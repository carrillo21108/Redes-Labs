# Use the official Node.js image as a base
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Make sure bash is installed (it's not included by default in alpine)
RUN apk add --no-cache bash

# Set the command to start a bash shell
CMD ["bash"]