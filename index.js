const express = require('express')
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const User = require('./Models/UserModel');
const Message = require('./Models/MessageModel')
const ws = require('ws');
const fs = require('fs');


dotenv.config();

mongoose.set('strictQuery', false)

mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,

}, (err) => {
  if (err) throw err;
  else console.log("database connected")
});

const bcryptSalt = bcrypt.genSaltSync(10);

const app = express();
app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(express.json());
app.use(cookieParser());
app.use(cors());

app.get('/test', (req, res) => {
  res.status(200).json({
    message: "Connected"
  })
})

const getUserData = async(req) => {
  return new Promise((resolve, reject) => {
    const token = req.cookies?.token;
    if(token) {
      jwt.verify(token, process.env.JWT_SECRET, {}, (err, userData) => {
        if(err) throw err;
        resolve(userData);
      })
    } else reject('No token');
  })
}

app.get('/message/:userId', async(req, res) => {
  const { userId } = req.params;
  const userData = await getUserData(req);
  const ourUserId = userData.userId;
  const messages = await Message.find({
    sender:{$in:[userId,ourUserId]},
    recipient:{$in:[userId,ourUserId]},
  }).sort({createdAt: 1});
  res.json(messages);

})

app.get('/people', async (req, res) => {
  const users = await User.find({}, { '_id': 1, username: 1 });
  res.json(users);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const foundUser = await User.findOne({ username });
  if (foundUser) {
    const passOk = bcrypt.compareSync(password, foundUser.password);
    if (!passOk) {
      res.status(401).json({
        message: "Wrong password"
      })
      jwt.sign({ userId: foundUser._id, username }, process.env.JWT_SECRET || '', {}, (err, token) => {
        if (err) throw err;
        res.cookie('token', token, { sameSite: 'none', secure: true }).json({
          id: foundUser._id,
        })
      })
    }
  } else {
    res.status(404).json({
      message: "User not found"
    })
  }
})

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const foundUser = await User.findOne({ username });
    if (foundUser) {
      res.status(409).json({
        message: "User already exists"
      })
    }
    const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
    const createdUser = await User.create({
      username: username,
      password: hashedPassword,
    });
    jwt.sign({userId:createdUser._id,username}, process.env.JWT_SECRET, {}, (err, token) => {
      if (err) throw err;
      res.cookie('token', token, {sameSite:'none', secure:true}).status(201).json({
        id: createdUser._id,
      });
    });
  } catch (err) {
    res.status(500).json(err);
  }
})

app.post('/logout', (req, res) => {
  res.cookie('token', '', { sameSite: 'none', secure: true }).json('ok');
});

const server = app.listen(process.env.PORT || 5000, (err) => {
  if (err) throw (err);
  else console.log('Server running on port ', process.env.PORT || 5000);
})

const wss = new ws.WebSocketServer({server});

