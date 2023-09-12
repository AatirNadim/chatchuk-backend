const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const User = require("./Models/UserModel");
const Message = require("./Models/MessageModel");
const ws = require("ws");
const fs = require("fs");

dotenv.config();

mongoose.set("strictQuery", false);

mongoose.connect(
  process.env.MONGO_URL,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
  (err) => {
    if (err) throw err;
    else console.log("database connected");
  }
);

const bcryptSalt = bcrypt.genSaltSync(10);

const app = express();
app.use(cookieParser());
app.use("/uploads", express.static(__dirname + "/uploads"));
app.use(express.json());
app.use(
  cors({
    credentials: true,
    optionsSuccessStatus: 200,
    exposedHeaders: ["set-cookie"],
    origin: "http://localhost:3001",
  })
);

app.get("/test", (req, res) => {
  // console.log("in the test --> ", req.headers);
  res.status(200).json({
    message: "Connected",
  });
});

const getUserData = async (req) => {
  return new Promise((resolve, reject) => {
    const token = req.cookies?.token;
    if (!token) reject("No token");

    jwt.verify(token, process.env.JWT_SECRET, {}, (err, userData) => {
      if (err) throw err;
      // console.log('userdata --> ------------\n', userData)
      resolve(userData);
    });
  });
};

app.get("/message/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userData = await getUserData(req);
    const ourUserId = userData.userId;
    // console.log('our user id --> ', ourUserId, 'requested user id --> ', userId)
    const messages = await Message.find({
      sender: { $in: [userId, ourUserId] },
      recipient: { $in: [userId, ourUserId] },
    }).sort({ createdAt: 1 });
    // console.log('message requested --> \n\n', messages)
    res.json(messages);
  } catch (err) {
    console.log(err);
    res.status(500).json(err);
  }
});

app.get("/people", async (req, res) => {
  const users = await User.find({}, { _id: 1, username: 1 });
  res.json(users);
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const foundUser = await User.findOne({ username });
  if (foundUser) {
    const passOk = bcrypt.compareSync(password, foundUser.password);
    if (!passOk) {
      return res.status(401).json({
        message: "Wrong password",
      });
    }
    jwt.sign(
      { userId: foundUser._id, username },
      process.env.JWT_SECRET,
      {},
      (err, token) => {
        if (err) throw err;
        // console.log("token generated for the user --> \n\n", token);
        res.cookie("token", token, { secure: false }).json({
          id: foundUser._id,
        });
      }
    );
  } else {
    res.status(404).json({
      message: "User not found",
    });
  }
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const foundUser = await User.findOne({ username });
    if (foundUser) {
      return res.status(409).json({
        message: "User already exists",
      });
    }
    const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
    const createdUser = await User.create({
      username: username,
      password: hashedPassword,
    });
    jwt.sign(
      { userId: createdUser._id, username },
      process.env.JWT_SECRET,
      {},
      (err, token) => {
        if (err) throw err;
        res
          .cookie("token", token, { sameSite: "none", secure: true })
          .status(201)
          .json({
            id: createdUser._id,
          });
      }
    );
  } catch (err) {
    res.status(500).json(err);
  }
});

app.post("/logout", (req, res) => {
  res.cookie("token", "", { sameSite: "none", secure: true }).json("ok");
});

const server = app.listen(process.env.PORT || 5000, (err) => {
  if (err) throw err;
  else console.log("Server running on port ", process.env.PORT || 5000);
});

const wss = new ws.WebSocketServer({ server });

// wss.on('connection', (connection, req) => {
//   // console.log('connection made --> \n\n', req.headers.cookie)
//   connection.send("hello from server")
//   const cookies = req.headers.cookie;
//   if(cookies) {
//     // console.log(cookies.split(';'));
//     const tokenStr = cookies.split(';').find(str => str.startsWith('token='))
//     // console.log(tokenStr);
//     if(tokenStr) {
//       // console.log(tokenStr.split('=')[1]);
//       jwt.verify(tokenStr.split('=')[1], process.env.JWT_SECRET, {}, (err, userData) => {
//         if(err) throw err;
//         console.log('userData --> ', userData)
//       })
//     }
//   }

// })

wss.on('connection', (connection, req) => {

  function notifyAboutOnlinePeople() {
    [...wss.clients].forEach(client => {
      // console.log('client --> ', client)
      client.send(JSON.stringify({
        online: [...wss.clients].map(c => {
          // console.log(c.userId, c.username, '---------------------------------------------');
          return {userId:c.userId,username:c.username}
        }),
      }));
    });
  }

  connection.isAlive = true;

  connection.timer = setInterval(() => {
    connection.ping();
    connection.deathTimer = setTimeout(() => {
      connection.isAlive = false;
      clearInterval(connection.timer);
      connection.terminate();
      notifyAboutOnlinePeople();
      console.log('dead');
    }, 1000);
  }, 5000);

  connection.on('pong', () => {
    clearTimeout(connection.deathTimer);
  });

  // read username and id form the cookie for this connection
  const cookies = req.headers.cookie;
  if (cookies) {
    const tokenCookieString = cookies.split(';').find(str => str.startsWith('token='));
    if (tokenCookieString) {
      const token = tokenCookieString.split('=')[1];
      if (token) {
        jwt.verify(token, process.env.JWT_SECRET, {}, (err, userData) => {
          if (err) throw err;
          const {userId, username} = userData;
          connection.userId = userId;
          connection.username = username;
        });
      }
    }
  }

  connection.on('message', async (message) => {
    const messageData = JSON.parse(message.toString());
    const {recipient, text, file} = messageData;
    let filename = null;
    if (file) {
      console.log('size', file.data.length);
      const parts = file.name.split('.');
      const ext = parts[parts.length - 1];
      filename = Date.now() + '.'+ext;
      const path = __dirname + '/uploads/' + filename;
      const bufferData = new Buffer(file.data.split(',')[1], 'base64');
      fs.writeFile(path, bufferData, () => {
        console.log('file saved:'+path);
      });
    }
    if (recipient && (text || file)) {
      // console.log('sender --> ', connection.userId, 'recipient --> ', recipient)
      const messageDoc = await Message.create({
        sender:connection.userId,
        recipient,
        text,
        file: file ? filename : null,
      });
      console.log('created message');
      [...wss.clients]
        .filter(c => c.userId === recipient)
        .forEach(c => c.send(JSON.stringify({
          text,
          sender:connection.userId,
          recipient,
          file: file ? filename : null,
          _id:messageDoc._id,
        })));
    }
  });

  // notify everyone about online people (when someone connects)
  notifyAboutOnlinePeople();
});
