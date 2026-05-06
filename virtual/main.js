const puppeteer = require('puppeteer');
const robot = require('@jitsi/robotjs');
const fs = require('fs');

let inSetup = false;

const srcDir = process.argv[2] ?? '';

process.env.DISPLAY = ':0.0';

const ctrlPorts = JSON.parse(fs.readFileSync(srcDir + 'ports.json'));
let config = {};

/**
 * @type {puppeteer.Browser}
 */
let browserInstance = null;
/**
 * @type {puppeteer.Page}
 */
let page = null;

async function start(settings, depth) {
    const puppeteerConfig = {
        headless: !inSetup,
        browser: config.browser,
        args: [
            '-new-instance',
            '-profile',
            `${srcDir}profile`
        ],
        extraPrefsFirefox: {
            'media.navigator.permission.disabled': true,
            'media.getusermedia.insecure.enabled': true
        }
    };

    browserInstance = await puppeteer.launch(puppeteerConfig);

    const link = `https://${config.vmAccessPort}:${config.webCommsPort}/`;

    page = await browserInstance.newPage();

    if (!inSetup) {
        await page.goto(link);

        await page.type('#defaultFps', config.defaultFPS.toFixed(0));

        await page.type('#maxFps', config.maxFPS.toFixed(0));

        await page.type('#fps', settings.fps.toFixed(0));

        page.click('button');
    }
}

async function stop() {
    if (page !== null) {
        await page.close();
        page = null;
    }

    if (browserInstance !== null) {
        await browserInstance.close();
        browserInstance = null;
    }
}

/**
 * @type {WebSocket}
 */
let ws = null;
let resetting = false;

function setupWebsocket() {
    resetting = false;
    ws = new WebSocket(`ws://${ctrlPorts.vmAccessPort}:${ctrlPorts.vmCommsPort}`);

    ws.addEventListener('close', e => {
        if (!resetting) {
            //console.log('Connection lost; resetting');
            setTimeout(e => {
                setupWebsocket();
            }, 5000);
            resetting = true;
        }
    });

    ws.addEventListener('error', e => {
        if (!resetting) {
            //console.log('Connection errored; resetting');
            setTimeout(e => {
                setupWebsocket();
            }, 5000);
            resetting = true;
        }
    });

    ws.addEventListener('message', e => {
        const data = JSON.parse(e.data);

        switch (data.type) {
            case 'config':
                config = data.message;
                break;
            case 'start':
                if (config) {
                    stop();
                    start(data.message, 0);
                } else {
                    ws.send(JSON.stringify({
                        type: 'requestConfig'
                    }));
                }
                break;
            case 'stop':
                stop();
                break;
            case 'kill':
                stop();
                ws.close();
                process.exit();
            case 'mousemove':
                handleMouseMove(data.message);
                break;
            case 'mouse':
                handleMouse(data.message);
                break;
            case 'wheel':
                handleWheel(data.message);
                break;
            case 'keyboard':
                handleKeyboard(data.message);
                break;
            default:
                console.log(data);
        }
    });

    robot.setKeyboardDelay(0);
}

// [left mouse down, middle mouse down, right mouse down]
const buttons = [false, false, false];

function handleMouse(msg) {
    handleMouseMove(msg);

    switch (msg.button) {
        case 0:
            buttons[0] = msg.mouseDown;
            robot.mouseToggle(msg.mouseDown ? 'down' : 'up', 'left');
            break;
        case 1:
            buttons[0] = msg.mouseDown;
            robot.mouseToggle(msg.mouseDown ? 'down' : 'up', 'middle');
            break;
        case 2:
            buttons[0] = msg.mouseDown;
            robot.mouseToggle(msg.mouseDown ? 'down' : 'up', 'right');
            break;
    }
}

function handleMouseMove(msg) {
    if (buttons[0] || buttons[1] || buttons[2]) {
        robot.dragMouse(msg.x, msg.y);
    } else {
        robot.moveMouse(msg.x, msg.y);
    }
}

function handleWheel(msg) {
    const dxStep = Math.ceil(Math.abs(msg.dx) / 72) * -Math.sign(msg.dx);
    const dyStep = Math.ceil(Math.abs(msg.dy) / 72) * -Math.sign(msg.dy);
    robot.scrollMouse(dxStep, dyStep);
}

function handleKeyboard(msg) {
    let key;

    // TODO: Add numpad support

    switch (msg.code) {
        case 'arrowup':
            key = 'up';
            break;
        case 'arrowdown':
            key = 'down';
            break;
        case 'arrowleft':
            key = 'left';
            break;
        case 'arrowright':
            key = 'right';
            break;
        default:
            key = msg.code.replace('key', '').replace('digit', '');
    }

    if (key === '"') {
        robot.keyToggle('\'', msg.down ? 'down' : 'up', 'shift');
        return;
    }

    try {
        robot.keyToggle(key, msg.down ? 'down' : 'up');
    } catch (err) {
        //console.log('Invalid code: ', key);
    }
}

process.on('SIGTERM', async () => {
    stop();
    if (ws !== null) {
        ws.addEventListener('close', e => {
            process.exit();
        });
        ws.close();
    } else {
        process.exit();
    }
});

setupWebsocket();