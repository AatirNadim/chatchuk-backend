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

const app = express();



app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin : process.env.CLIENT_URL,
  credentials : true
}))

app.get('/test', (req, res) => {
  res.status(200).json({
    message : "Connected"
  })
})

app.get('/people', async (req,res) => {
  const users = await User.find({}, {'_id':1,username:1});
  res.json(users);
});

app.get('/login', async (req, res) => {
  const { username, password } = req.body;
  const foundUser = await User.findOne({ username });
  if(foundUser) {
    const passOk = bcrypt.compareSync(password, foundUser.password);
    if(!passOk) {
      res.status(401).json({
        message : "Wrong password"
      })
      jwt.sign({ userId : foundUser._id, username }, process.env.JWT_SECRET || '', {}, (err, token) => {
        if(err) throw err;
        res.cookie('token', token, {sameSite:'none', secure:true}).json({
          id : foundUser._id,
        })
      })
    }
  } else {
    res.status(404).json({
      message : "User not found"
    })
  }
})

app.post('/logout', (req,res) => {
  res.cookie('token', '', {sameSite:'none', secure:true}).json('ok');
});

const server = app.listen(process.env.PORT || 5000, (err) => {
  if(err) throw(err);
  else console.log('Server running on port ', process.env.PORT || 5000);
})