const websocket = require('ws');
const fs = require('fs');
const http = require('http');
const https = require('https');
const readline = require('readline');
const turn = require('node-turn');
const childprocess = require('child_process');
const path = require('path');

const config = JSON.parse(fs.readFileSync('../config.json'));

const lastKeyReset = parseInt(fs.readFileSync('keys/last.txt'));

if (Date.now() - lastKeyReset > 2628000000) { // More than a month!
    fs.writeFileSync('keys/last.txt', Date.now().toFixed(0));
    childprocess.execSync('call keygen.bat');
}

const interface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const turnConfig = {
    authMech: 'long-term',
    credentials: {},
    listeningPort: config.stunTurnPort
}

turnConfig.credentials[config.stunTurnUsername] = config.stunTurnPassword;

const turnServer = new turn(turnConfig);

turnServer.start();

const keys = {
    key: fs.readFileSync('keys/key.pem'),
    cert: fs.readFileSync('keys/cert.pem')
};

const externalAppJS = fs.readFileSync('public/app.js');
const externalStylesCss = fs.readFileSync('public/styles.css');
const externalIndexHtml = fs.readFileSync('public/index.html');

const externalServer = https.createServer(keys, (req, res) => {
    switch (req.url) {
        case '/app.js':
            res.writeHead(200, {'Content-Type': 'text/javascript'});
            res.write(externalAppJS);
            break;
        case '/styles.css':
            res.writeHead(200, {'Content-Type': 'text/css'});
            res.write(externalStylesCss);
            break;
        default:
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.write(externalIndexHtml);
    }
    res.end();
});

const cmdCtrlServer = http.createServer((req, res) => {
    res.writeHead(200);
    res.end();
});

const internalRemoteJs = fs.readFileSync('private/remote.js').toString().replaceAll('%webCommsPort%', config.webCommsPort).replaceAll('%hostIP%', config.vmAccessPort);
const internalIndexHtml = fs.readFileSync('private/index.html');

const internalServer = https.createServer(keys, (req, res) => {
    switch (req.url) {
        case '/remote.js':
            res.writeHead(200, {'Content-Type': 'text/javascript'});
            res.write(internalRemoteJs);
            break;
        default:
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.write(internalIndexHtml);
    }
    res.end();
});

const externalSocket = new websocket.Server({server: externalServer});
/**
 * @type {websocket}
 */
let externalConnection = null;
let allowedToken = '';

const cmdCtrlSocket = new websocket.Server({server: cmdCtrlServer});
/**
 * @type {websocket}
 */
let cmdCtrlConnection = null;

const internalSocket = new websocket.Server({server: internalServer});
/**
 * @type {websocket}
 */
let internalConnection = null;

let savedCheck = '';

externalSocket.on('connection', ws => {
    savedCheck = '';
    ws.on('message', msg => {
        const str = msg.toString();
        const data = JSON.parse(str);

        if (data.type !== 'start' && (allowedToken === '' || data.auth.token !== allowedToken)) {
            ws.close();
            externalConnection = null;
            allowedToken = '';
            return;
        }

        switch (data.type) {
            case 'answer':
                if (internalConnection !== null) {internalConnection.send(str)}
                break;
            case 'candidate':
                if (internalConnection !== null) {internalConnection.send(str)}
                break;
            case 'ready':
                if (internalConnection !== null) {internalConnection.send(str)}
                break;
            case 'mousemove':
                if (cmdCtrlConnection !== null) {cmdCtrlConnection.send(str)}
                break;
            case 'mouse':
                if (cmdCtrlConnection !== null) {cmdCtrlConnection.send(str)}
                break;
            case 'wheel':
                if (cmdCtrlConnection !== null) {cmdCtrlConnection.send(str)}
                break;
            case 'keyboard':
                if (cmdCtrlConnection !== null) {cmdCtrlConnection.send(str)}
                break;
            case 'start':
                if ((data.auth.username === config.loginUsername && data.auth.password === config.loginPassword) || (allowedToken !== '' && data.auth.token === allowedToken)) {
                    allowedToken = generateToken();
                    ws.send(JSON.stringify({
                        type: 'token',
                        message: allowedToken
                    }));
                } else {
                    ws.send('{"type": "status", "message": "Incorrect Login Details"}');
                    return;
                }
                if (cmdCtrlConnection !== null && cmdCtrlConnection.readyState !== websocket.CLOSED) {
                    ws.send('{"type": "status", "message": "Starting Video Transmitter"}');
                    setResolution(data.message.width, data.message.height);
                    cmdCtrlConnection.send(str);
                } else {
                    savedCheck = str;
                    ws.send('{"type": "status", "message": "Starting Control Server"}');
                    setupCmdCtrl(0);
                }
                break;
            default:
                console.log('Erroneous external message: ', data);
        }
    });

    externalConnection = ws;
});

externalSocket.on('close', e => {
    externalConnection = null;
});

externalSocket.on('error', e => {
    externalConnection = null;
});

cmdCtrlSocket.on('connection', ws => {
    ws.on('message', msg => {
        const str = msg.toString();
        const data = JSON.parse(str);

        switch (data.type) {
            case 'requestConfig':
                ws.send({
                    type: 'config',
                    message: config
                });
                break;
            default:
                return;
        }
    });

    ws.send(JSON.stringify({
        type: 'config',
        message: config
    }));

    if (savedCheck.length > 0) {
        const data = JSON.parse(savedCheck);
        setResolution(data.message.width, data.message.height);
        ws.send(savedCheck);
        savedCheck = '';
    }

    if (externalConnection !== null) {externalConnection.send('{"type": "status", "message": "Starting Video Transmitter"}');}

    cmdCtrlConnection = ws;
});

cmdCtrlSocket.on('close', e => {
    cmdCtrlConnection = null;
});

cmdCtrlSocket.on('error', e => {
    cmdCtrlConnection = null;
});

internalSocket.on('connection', ws => {
    ws.on('message', msg => {
        const str = msg.toString();
        const data = JSON.parse(str);

        switch (data.type) {
            case 'candidate':
                if (externalConnection !== null) {externalConnection.send(str)}
                break;
            case 'offer':
                if (externalConnection !== null) {externalConnection.send(str)}
                break;
            case 'ready':
                if (externalConnection !== null) {onReady(externalConnection)}
                break;
            default:
                console.log('Erroneous internal message: ', data);
        }
    });

    internalConnection = ws;
});

internalSocket.on('close', e => {
    internalConnection = null;
});

internalSocket.on('error', e => {
    internalConnection = null;
});

function generateToken() {
    const characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

    let token = '';

    for (let i = 0; i < config.tokenLength; i++) {
        token += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return token;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function checkNumber(n, min, max, def) {
    n = parseInt(n);
    if (isNaN(n)) {
        return def;
    }
    return Math.min(Math.max(n, min), max);
}

async function startVM(attempt, then = Date.now()) {
    if (attempt === 0) {
        console.log('Booting VM');
        if (externalConnection !== null) {externalConnection.send('{"type": "status", "message": "Booting VM"}')}
    } else if (attempt === 1) {
        console.log('Encountered error, retrying');
        if (externalConnection !== null) {externalConnection.send('{"type": "status", "message": "VM Start Fail, Retrying"}')}
    }

    childprocess.spawnSync('powershell.exe', [path.resolve(__dirname, 'killVBox.ps1')]);

    childprocess.spawnSync(config.vBoxManageDirectory, [
        '--nologo', 'startvm',
        config.virtualMachineName,
        //'--type=headless'
        '--type=gui'
    ], { encoding: 'utf-8'});

    if (isRunning()) {
        console.log(`VM Booted in ${Date.now() - then} ms`);
        await sleep(30000);
        if (externalConnection !== null) {externalConnection.send('{"type": "status", "message": "VM Booted"}')}
        return true;
    } else if (attempt === 0) {
        return startVM(1, then);
    } else if (attempt === 1) {
        console.log(`Second attempt failed in ${Date.now() - then} ms, quitting`);
        if (externalConnection !== null) {externalConnection.send('{"type": "status", "message": "VM Start Fail, Quitting"}')}
        return false;
    }

    return true;
}

function isRunning() {
    const output = childprocess.spawnSync(config.vBoxManageDirectory, [
        'list', 'runningvms'
    ], { encoding: 'utf-8'}).stdout;

    return output.indexOf(config.virtualMachineName) !== -1;
}

function powerOff() {
    childprocess.spawnSync(config.vBoxManageDirectory, [
        'controlvm',
        config.virtualMachineName,
        'poweroff'
    ]);
}

function setResolution(x, y) {
    const opts = [
        'controlvm',
        config.virtualMachineName,
        'setvideomodehint',
        checkNumber(x, 0, config.maxWidth, config.defaultWidth).toFixed(0),
        checkNumber(y, 0, config.maxHeight, config.defaultHeight).toFixed(0),
        32 // No clue if bits per pixel changes anything
    ];

    //console.log(opts.join(' '));

    const output = childprocess.spawnSync(config.vBoxManageDirectory, opts, { encoding: 'utf-8'});

    //console.log(output.stdout);
    //console.log(output.stderr);
}

let puppetProcess = null;
let restartingCmdCtrl = false;

async function setupCmdCtrl(reg) {
    restartingCmdCtrl = false;
    if (reg >= 2) {
        console.log('VM Stall, rebooting');
        if (externalConnection !== null) {externalConnection.send('{"type": "status", "message": "VM Stall"}')}
        powerOff();
    }

    if (!isRunning() || reg > 2) {
        reg = 0;
        const then = Date.now();
        if (!startVM(0)) {
            return;
        }
        await sleep(30000); // Wait for gui to setup properly, among other things
        console.log(`Boot delay finished, full startup took ${Date.now() - then} ms`);
    }

    childprocess.spawnSync(config.vBoxManageDirectory, [
        'guestcontrol', 
        config.virtualMachineName,
        'closesession', '--all'
    ]);

    const opts = [
        'guestcontrol',
        config.virtualMachineName,
        'run', '--exe',
        config.nodeDirectory,
        '--username',
        config.vmUsername,
        '--password',
        config.vmPassword,
        '--',
        config.vmAccessPath + 'main.js',
        config.vmAccessPath
    ];

    puppetProcess = childprocess.spawn(config.vBoxManageDirectory, opts, {stdio: 'pipe'});

    //process.stdout.on('data', e => console.log(e.toString()));
    puppetProcess.stderr.on('data', e => {
        if (restartingCmdCtrl) {
            return;
        }
        try {
            puppetProcess.close();
        } catch (err) {}
        console.log(e.toString());
        puppetProcess = null;
        console.log('Puppet error, retrying');
        if (externalConnection !== null) {externalConnection.send('{"type": "status", "message": "Puppet Error, Retrying"}')}
        restartingCmdCtrl = true;
        setTimeout(() => setupCmdCtrl(reg + 1), 5000);
    });
}

function onReady(ws) {
    ws.send(JSON.stringify({
        type: 'ready',
        message: {
            iceServers: [
                {
                    urls: 'stun:' + config.globalIpAddress + ':' + config.stunTurnPort,
                    username: config.stunTurnUsername,
                    credential: config.stunTurnPassword
                },
                {
                    urls: 'turn:' + config.globalIpAddress + ':' + config.stunTurnPort,
                    username: config.stunTurnUsername,
                    credential: config.stunTurnPassword
                }
            ]
        }
    }));
}

if (!isRunning()) {
    startVM(0);
}

internalServer.listen(config.webCommsPort);
cmdCtrlServer.listen(config.vmCommsPort);
externalServer.listen(config.exposedPort);

console.log(`Listening on port ${config.exposedPort}.\nGo to \x1b[94mhttps://localhost:${config.exposedPort}/\x1b[0m to view.`);

interface.question(
    'Press [Enter] to quit.\n', () => {
        console.log('Stopping!');
        if (cmdCtrlConnection !== null) {
            cmdCtrlConnection.send('{"type": "kill"}');
        }
        internalServer.close();
        externalServer.close();
        process.exit();
    }
);