import express from 'express'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import * as url from 'url';
import bcrypt from 'bcryptjs';
import * as SimpleWebAuthnServer from '@simplewebauthn/server';
import session from 'express-session';


/****************
 * WEBAUTH CONFIG RELYING PARTY (RP) VARIABLES
 ****************/
const rpName = "Coffee Masters"
const rpID = "localhost";
const protocol = "http";
const port = 5050;
const expectedOrigin = `${protocol}://${rpID}:${port}`;
// Note: it's now possible to have an array of rpIDs and expected origins following multi-origin specs

/****************
 * DATA STORAGE SET UP
 ****************/
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const adapter = new JSONFile(__dirname + '/auth.json');
const db = new Low(adapter);
await db.read();
db.data ||= { users: [] }

/****************
 * EXPRESSJS SERVER SETUP
 ****************/
const app = express()
app.use(express.json())

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.use(session({
    secret: "a very strong secret key",  // Change this to a strong secret
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }   // Set true if using HTTPS
}));


/****************
 * STANDARD LOGIN SERVICES 
 ****************/

function findUser(email) {
    const results = db.data.users.filter(u=>u.email==email);
    if (results.length==0) return undefined;
    return results[0];
}

app.post("/auth/register", (req, res) => {
    var salt = bcrypt.genSaltSync(10);
    var hash = bcrypt.hashSync(req.body.password, salt);

    const user = {
        name: req.body.name,
        email: req.body.email,
        password: hash
    };
    const userFound = findUser(req.body.email);

    if (userFound) {
        // User already registered
        res.send({ok: false, message: 'User already exists'});
    } else {
        // New User
        db.data.users.push(user);
        db.write();
        res.send({ok: true});
    }
});

app.post("/auth/login", (req, res) => {
    const user = findUser(req.body.email);
    if (user) {
        // user exists, check password
        if (bcrypt.compareSync(req.body.password, user.password)) {
            res.send({ok: true, email: user.email, name: user.name});
        } else {
            res.send({ok: false, message: 'Your login credentials are invalid.'});            
        }
    } else {
        // User doesn't exist
        res.send({ok: false, message: 'Your login credentials are invalid.'});
    }
});

app.post("/auth/auth-options", (req, res) => {
    const user = findUser(req.body.email);    

    if (user) {
        res.send({
            password: true,
            webauthn: user.webauthn
        })
    } else {
        res.send({
            password: true
        })
    }
});
/****************
 * WEBAUTH PASSKEY REGISTRATION SERVICES
 ****************/

// TODO: Step 1


/****************
 * WEBAUTH PASSKEY AUTHENTICATION (LOGIN) SERVICES
 ****************/

// TODO: Step 2


/****************
 * EXPRESS JS SET UP
 ****************/

app.get("*", (req, res) => {
    res.sendFile(__dirname + "public/index.html"); 
});

app.listen(port, () => {
  console.log(`App listening on http://localhost:${port}`)
});

