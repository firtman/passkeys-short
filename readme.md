# Implementing Passkeys - short workshop
# Workshop by Maximiliano Firtman @firt (X) - firt.dev - hi@firt.dev

Run `npm install` in this project to get all dependencies. 
Then, you can follow along the workshop with instructions delivered by the trainer.
In the assets folders, you will find a copy of the slides and a final project of the project.

## Code Snippets

### 1-Add WebAuthn Registration endpoints

－ In server.js add
```js
app.post("/auth/webauthn-registration-options", async (req, res) =>{
   try {
       const user = findUser(req.body.email);

       const options = {
           rpName,
           rpID,
           userName: user.name,
           attestationType: 'none', // Better UX, Don't prompt users for additional information about the authenticato

           // Optional, Prevent users from re-registering existing authenticators
           // excludeCredentials: user.passkeys ? user.passkeys.map(pk => ({
           //     id: pk.credentialID,
           //     transports: pk.transports,
           // })) : [],

           authenticatorSelection: {
               // Defaults
               residentKey: 'preferred',
               userVerification: 'preferred',
               // Optional
               // authenticatorAttachment: 'platform', // platform or cross-platform
               // Optional
               // preferredAuthenticatorType: '', // securityKey, localDevice, remoteDevice
           },
       };

       /**
        * The server needs to temporarily remember this value for verification, so don't lose it until
        * after you verify an authenticator response.
        */
       const regOptions = await SimpleWebAuthnServer.generateRegistrationOptions(options)
       user.currentChallenge = regOptions.challenge;
       db.write();  
      
       // Send response to the client
       res.send(regOptions);
   } catch (e) {
       res.status(500);
   }
});

app.post("/auth/webauthn-registration-verification", async (req, res) => {
   const user = findUser(req.body.user.email);
   const data = req.body.data;
  
   let verification;
   try {
     const options = {
       response: data,
       expectedChallenge: user.currentChallenge,
       expectedOrigin,
       expectedRPID: rpID,
       requireUserVerification: true,
     };
     verification = await SimpleWebAuthnServer.verifyRegistrationResponse(options);
   } catch (error) {
       console.log(error);
     return res.status(400).send({ error: error.toString() });
   }
    const { verified, registrationInfo } = verification; 

   if (verified && registrationInfo) {    
      const existingPasskey = user.passkeys ? user.passkeys.find(
       passkey => passkey.id == registrationInfo.credential.id
     ) : false;
      if (!existingPasskey) {
       const newPasskey = registrationInfo.credential;
       if (user.passkeys==undefined) {
           user.passkeys = [];
       }
       user.webauthn = true;
       user.passkeys.push(newPasskey);
       db.write();
     }
   } else {
       console.log("Passkey already stored.")
   }
    res.send({ ok: true });
});
```


### 2-Add WebAuthn Login endpoints

－ In server.js add
```js
app.post("/auth/webauthn-login-options", async (req, res) =>{
   const user = findUser(req.body.email);
   const options = {
       allowCredentials: user && user.passkeys ? user.passkeys.map(passkey => ({
         id: passkey.id,
         transports: passkey.transports,
       })) : [],
       userVerification: 'required',
       rpID,
   };
   const loginOpts = await SimpleWebAuthnServer.generateAuthenticationOptions(options);
   if (user) {
       user.currentChallenge = loginOpts.challenge;
       db.write();
   } else {
       req.session.webauthnChallenge = loginOpts.challenge;;
   }
   res.send(loginOpts);
});

app.post("/auth/webauthn-login-verification", async (req, res) => {
   const data = req.body.data;
   let user = findUser(req.body.email);
   if (user==null) {
       res.sendStatus(400).send({ok: false});
       return;       
   }
    const expectedChallenge = user.currentChallenge;
    let registeredPasskey;
   const { id } = data;

   let candidates;
   if (user) {
       candidates = [user]; // Just the current user
   } else {
       candidates = db.data.users;
   }

   // Find passkeys on candidate users        
   for (const candidate of candidates) {
       for (const passkey of candidate.passkeys) {
           if (passkey.id == id) {
               registeredPasskey = passkey;
               user = candidate;
               break;
           }
       }
   }

   if (!registeredPasskey) {
     return res.status(400).send({ ok: false, message: 'Passkey is not registered with this site' });
   }
    // Verifies the passkey
   let verification;
   try {
     const options  = {
       response: data,
       expectedChallenge: expectedChallenge,
       expectedOrigin,
       expectedRPID: rpID,
       credential: {
           id: registeredPasskey.id,
           publicKey: Buffer.from(Object.values(registeredPasskey.publicKey)), // converts it back into a Buffer
           counter: registeredPasskey.counter,
           transports: registeredPasskey.transports,
       },       
       requireUserVerification: true,
     };
     verification = await SimpleWebAuthnServer.verifyAuthenticationResponse(options);
   } catch (error) {
     console.log(error);
     return res.status(400).send({ ok: false, message: error.toString() });
   }
    const { verified, authenticationInfo } = verification;
    if (verified) {
     registeredPasskey.counter = authenticationInfo.newCounter;
     db.write();
   }
    // Send response to the client
   res.send({
       ok: true,
       user: {
           name: user.name,
           email: user.email
       }
   });
});
```


### 3-Add WebAuthn endpoints to the client

－ Finally, we add these endpoints to API.js
```js
   webAuthn: {
       loginOptions: async (email="") => {
           return await API.makePostRequest(API.endpoint + "webauthn-login-options", { email });
       },
       loginVerification: async (email, data) => {
           return await API.makePostRequest(API.endpoint + "webauthn-login-verification", {
               email,
               data
           });                      
       },
       registrationOptions: async () => {
           return await API.makePostRequest(API.endpoint + "webauthn-registration-options", Auth.account);          
       },
       registrationVerification: async (data) => {
           return await API.makePostRequest(API.endpoint + "webauthn-registration-verification", {
               user: Auth.account,
               data
           });                      
       }
   },
```


### 4-Registering a Passkey

－ In our HTML, let's add some code in the account view
```html
<section id="webauthn">
    <button onclick="Auth.addWebAuthn()">Register a New Passkey</button>
</section>
```

－ Then, in Auth.js
```js
    addWebAuthn: async () => {          
       const options = await API.webAuthn.registrationOptions();       
       options.authenticatorSelection.residentKey = 'required';
       options.authenticatorSelection.requireResidentKey = true;
       options.extensions = {
         credProps: true,
       };
       const authRes = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
       const verificationRes = await API.webAuthn.registrationVerification(authRes);
       if (verificationRes.ok) {
           alert("You can now login using the registered method!");
       } else {
           alert(verificationRes.message)
       }
   },
```


### 5-Authorizing with a Passkey

－ Let's first change index.html in the login form
```html
<section hidden id="login_section_webauthn">
    <a href="#" class="navlink" onclick="Auth.webAuthnLogin(); event.preventDefault">Log in with a Passkey</a> 
</section>                                      
```

－ And finally on Auth.js we add:
```js
webAuthnLogin: async () => {
       const email = document.getElementById("login_email").value;
       const options = await API.webAuthn.loginOptions(email);       
       const loginRes = await SimpleWebAuthnBrowser.startAuthentication({
           optionsJSON: options,
        });
       const verificationRes = await API.webAuthn.loginVerification(email, loginRes);
       if (verificationRes) {
           Auth.postLogin(verificationRes, verificationRes.user);
       } else {
           alert(verificationRes.message)
       }
   },
```


### 6-Conditional UI for Passkeys

－ A- Let's first change index.html in the login form and add webauthn to the email input
```html
<input placeholder="email" id="login_email"
       required autocomplete="username webauthn">  
```


－ B-Now, in Auth.js we add:
```js
  webAuthnAutofill: async () => {
       const options = await API.webAuthn.loginOptions();       
       const loginRes = await SimpleWebAuthnBrowser.startAuthentication({
           optionsJSON: options,
           useBrowserAutofill: true
        });
       const verificationRes = await API.webAuthn.loginVerification(null, loginRes);
       if (verificationRes) {
           Auth.postLogin(verificationRes, verificationRes.user);
       } else {
           alert(verificationRes.message)
       }
   }
```

－ C-And in the same file, add this call within init:
```js
Auth.webAuthnAutofill();
```


### 7-Update endpoints to support conditional UI

－ Within server.js update the service to support conditional UI
```js

app.post("/auth/webauthn-login-verification", async (req, res) => {
   const data = req.body.data;
   let user = findUser(req.body.email);
   const expectedChallenge = user ? user.currentChallenge : req.session.webauthnChallenge;
    let registeredPasskey;
   const { id } = data;

   let candidates;
   if (user) {
       candidates = [user]; // Just the current user
   } else {
       candidates = db.data.users;
   }

   // Find passkeys on candidate users        
   for (const candidate of candidates) {
       for (const passkey of candidate.passkeys) {
           if (passkey.id == id) {
               registeredPasskey = passkey;
               user = candidate;
               break;
           }
       }
   }

   if (!registeredPasskey) {
     return res.status(400).send({ ok: false, message: 'Passkey is not registered with this site' });
   }
    // Verifies the passkey
   let verification;
   try {
     const options  = {
       response: data,
       expectedChallenge: expectedChallenge,
       expectedOrigin,
       expectedRPID: rpID,
       credential: {
           id: registeredPasskey.id,
           publicKey: Buffer.from(Object.values(registeredPasskey.publicKey)), // converts it back into a Buffer
           counter: registeredPasskey.counter,
           transports: registeredPasskey.transports,
       },       
       requireUserVerification: true,
     };
     verification = await SimpleWebAuthnServer.verifyAuthenticationResponse(options);
   } catch (error) {
     console.log(error);
     return res.status(400).send({ ok: false, message: error.toString() });
   }
    const { verified, authenticationInfo } = verification;
    if (verified) {
     registeredPasskey.counter = authenticationInfo.newCounter;
     db.write();
   }
    // Send response to the client
   res.send({
       ok: true,
       user: {
           name: user.name,
           email: user.email
       }
   });
});
```

