# Use Node.js LTS
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source code
COPY . .

# Expose port (Cloud Run expects this)
ENV PORT=8080
EXPOSE 8080

# Start app
CMD [ "npm", "start" ]
