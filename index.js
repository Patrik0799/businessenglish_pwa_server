const configs = require(`${__dirname}/configs.json`);
const config = configs.local;

let mongodb = require("mongodb");
const http = require("http");
//const WebSocket = require("ws");
const webpush = require("web-push");
const deparam = require("node-jquery-deparam");
const moment = require("moment");
require("dotenv").config();

const publicVapidKey = process.env.PUBLIC_VAPID_KEY;
const privateVapidKey = process.env.PRIVATE_VAPID_KEY;
const MONGO_URL = process.env.MONGO_URL;

webpush.setVapidDetails(
  "mailto:test@test.com",
  publicVapidKey,
  privateVapidKey
);

connectMongoDB(() => {
  if (!mongodb || !config.mongo)
    console.log("No MongoDB found => Server runs without MongoDB.");

  startWebserver();

  function startWebserver() {
    const http_server = http.createServer(handleRequest);

    /*const websocket_server = new WebSocket.Server({ server: http_server });

    websocket_server.on("connection", ws => {
      console.log("WebSocket connection established");

      ws.on("message", message => {
        console.log("Received message ", message);

        ws.send("Server received your message", message);
      });
    });

    websocket_server.on("close", () => {
      console.log("A client has disconnected.");
    });*/

    http_server.listen(config.http.port);

    console.log("Server is running.");
    console.log(
      "- http://" +
        config.domain +
        ":" +
        config.http.port +
        " (using HTTP protocol)"
    );
  }

  function handleRequest(request, response) {
    // CORS
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.statusCode = 200;
      response.end();
      return;
    }

    if (request.method === "POST") {
      let body = "";
      request.on("data", data => {
        body += data;
        if (body.length > config.max_data_size) request.shouldKeepAlive = false;
      });
      request.on("end", () => {
        if (body.length > config.max_data_size) {
          response.statusCode = 413;
          response.end();
        } else {
          try {
            console.log(JSON.parse(body));
            proceed(JSON.parse(body));
          } catch (e) {
            response.statusCode = 403;
            response.end();
          }
        }
      });
    } else proceed(deparam(request.url.substr(2)));

    function proceed(data) {
      // Support cross domain requests via CORS
      response.setHeader("Access-Control-Allow-Origin", "*");
      console.log(data);

      if (!checkReceivedData(data)) return sendForbidden();

      if (!data.get && !data.set && !data.del) return sendForbidden();

      performDatabaseOperation(data, result => {
        // Send result to client
        result === undefined
          ? sendForbidden()
          : send(data.get ? result : data.set ? result.key : true);
      });

      // Sends response to a client
      function send(response_data) {
        // Response is not a string? => transform data to JSON string
        response_data =
          typeof response_data !== "string"
            ? JSON.stringify(response_data)
            : response_data;

        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });

        response.end(response_data);
      }

      function sendForbidden() {
        response.statusCode = 403;
        response.end();
      }
    }
  }

  function checkReceivedData(data) {
    if (data.store && typeof data.store !== "string") return false;
    if (data.get && !isKey(data.get) && !isObject(data.get)) return false;
    if (data.set) {
      if (!isObject(data.set)) return false;
      if (!data.set.key || !isKey(data.set.key)) return false;
    }
    if (data.del && !isKey(data.del)) return false;

    // Received data is valid
    return true;
  }

  function performDatabaseOperation(data, callback) {
    // Select kind of database
    useMongoDB();

    function useMongoDB() {
      // Get collection
      mongodb.collection(data.store, (err, collection) => {
        if (data.get) get(); // read
        else if (data.set) set(); // create or update
        else if (data.del) del(); // delete

        function get() {
          // Perform read operation
          getDataset(data.get, results => {
            finish(results);
          });
        }

        async function set() {
          const push_subs = mongodb.collection("push_subs");
          const query = { _id: "push_notification" };
          const subscription = await push_subs.findOne(query);

          console.log("SUB OBJECT:", subscription.value);

          const payload = JSON.stringify({
            title: "New Update",
            section: data.set.key[0],
            person: data.set.key[1],
          });

          getDataset(data.set.key, existing_dataset => {
            // Priority data
            const priodata = convertDataset(data.set);

            // Set 'updated_at' timestamp
            priodata.updated_at = moment().format();

            // Dataset exists? (then it's an update operation)
            if (existing_dataset) {
              // Attributes that have to be unset
              const unset_data = {};
              for (const key in priodata)
                if (priodata[key] === "") {
                  unset_data[key] = priodata[key];
                  delete priodata[key];
                }

              // Update dataset
              if (Object.keys(unset_data).length > 0)
                collection.updateOne(
                  { _id: priodata._id },
                  { $set: priodata, $unset: unset_data },
                  success
                );
              else
                collection.updateOne(
                  { _id: priodata._id },
                  { $set: priodata },
                  success
                );
            } else {
              priodata.created_at = priodata.updated_at;
              collection.insertOne(priodata, success);
            }

            function success() {
              getDataset(data.set.key, finish);
              webpush
                .sendNotification(subscription.value, payload)
                .catch(err => {
                  console.log(err);
                });
            }
          });
        }

        function del() {
          // Read existing dataset
          getDataset(data.del, existing_dataset => {
            // Delete dataset and perform callback with deleted dataset
            collection.deleteOne({ _id: convertKey(data.del) }, () =>
              finish(existing_dataset)
            );
          });
        }

        function getDataset(key_or_query, callback) {
          // Read dataset(s)
          collection
            .find(
              isObject(key_or_query)
                ? key_or_query
                : { _id: convertKey(key_or_query) }
            )
            .toArray((err, res) => {
              // When result is null
              if (!res) return callback(res);

              // Convert MongoDB dataset(s) in ccm dataset(s)
              for (let i = 0; i < res.length; i++)
                res[i] = reconvertDataset(res[i]);

              // Read dataset by key? => result is dataset or NULL
              if (!isObject(key_or_query)) res = res.length ? res[0] : null;

              // Perform callback with reconverted result(s)
              callback(res);
            });
        }

        /**
         * Converts ccm dataset key to MongoDB dataset key
         * @param {ccm.types.key} key - ccm dataset key
         * @returns {string} MongoDB dataset key
         */
        function convertKey(key) {
          return Array.isArray(key) ? key.join() : key;
        }

        /**
         * Converts MongoDB key to ccm dataset key
         * @param {string} key - MongoDB dataset keyF
         * @returns {ccm.types.key} ccm dataset key
         */
        function reconvertKey(key) {
          return typeof key === "string" && key.indexOf(",") !== -1
            ? key.split(",")
            : key;
        }

        /**
         * Converts ccm dataset to MongoDB dataset
         * @param {Object} ccm_dataset - ccm dataset
         * @returns {ccm.types.dataset} MongoDB dataset
         */
        function convertDataset(ccm_dataset) {
          const mongodb_dataset = clone(ccm_dataset);
          mongodb_dataset._id = convertKey(mongodb_dataset.key);
          delete mongodb_dataset.key;
          return mongodb_dataset;
        }

        /**
         * Reconverts MongoDB dataset to ccm dataset
         * @param {Object} mongodb_dataset - MongoDB dataset
         * @returns {ccm.types.dataset} ccm dataset
         */
        function reconvertDataset(mongodb_dataset) {
          const ccm_dataset = clone(mongodb_dataset);
          ccm_dataset.key = reconvertKey(ccm_dataset._id);
          delete ccm_dataset._id;
          return ccm_dataset;
        }

        /**
         * Makes a deep copy of an object
         * @param {Object} obj - object
         * @returns {Object} deep copy of object
         */
        function clone(obj) {
          return JSON.parse(JSON.stringify(obj));
        }
      });
    }

    /** Finishes database operation */
    function finish(results) {
      // perform callback with result(s)
      callback(results);
    }
  }

  /**
   * Checks if a value is a valid ccm dataset key
   * @param {*} value - value to check
   * @returns {boolean}
   */
  function isKey(value) {
    /**
     * Definition of a valid dataset key
     * @type {RegExp}
     */
    const regex = /^[a-zA-Z0-9_\-]+$/;

    // Value is a string? => check if it is an valid key
    if (typeof value === "string") return regex.test(value);

    // Value is an array? => check if it is an valid array key
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++)
        if (!regex.test(value[i])) return false;
      return true;
    }

    // Value is not a dataset key? => not valid
    return false;
  }

  /**
   * Checks value if it is an object (including not null and not array)
   * @param {*} value - value to check
   * @returns {boolean}
   */
  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
});

//Creates connection to MongoDB
function connectMongoDB(callback, waited) {
  if (!mongodb || !config.mongo) return callback();
  mongodb.MongoClient.connect(
    MONGO_URL,
    { useNewUrlParser: true },
    (err, client) => {
      if (!err) {
        mongodb = client.db(config.mongo.db);
        return callback();
      }
      if (!waited) {
        setTimeout(() => connectMongoDB(callback, true), 3000);
      } else {
        mongodb = null;
        callback();
      }
    }
  );
}
