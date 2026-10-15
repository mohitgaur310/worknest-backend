# Worknest backend

Node.js API scaffold using Express and Mongoose.

## Install

```bash
cd /home/mohitgaur/wms/Worknest-backend
cp .env.example .env
npm install
```

## Run MongoDB

The API expects MongoDB at `mongodb://127.0.0.1:27017/worknest`.

Start a local MongoDB server, for example:

```bash
mongod --dbpath ~/worknest-mongo-data
```

Or with Docker:

```bash
docker run --name worknest-mongo -p 27017:27017 -d mongo:7
```

The API process still starts when MongoDB is down. `GET /health` reports the current connection state (`disconnected`, `connecting`, `connected`, or `disconnecting`).

## Start the API

```bash
npm start
```

For restart-on-change during development:

```bash
npm run dev
```

Health check: [http://localhost:4000/health](http://localhost:4000/health)
