FROM node:20-bullseye-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends imagemagick && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
