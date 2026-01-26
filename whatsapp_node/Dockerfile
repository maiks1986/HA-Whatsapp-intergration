ARG BUILD_FROM
FROM $BUILD_FROM

# Install Node.js and build tools
RUN apk add --no-cache nodejs npm python3 make g++ git

WORKDIR /app

# Copy package files
COPY package.json .
COPY tsconfig.json .

# Install dependencies
RUN npm install

# Copy source
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Expose ports
EXPOSE 5002

# Start script
CMD ["npm", "start"]
