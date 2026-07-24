const fs = require('fs');
const path = require('path');

describe('Optimistic UI DOM Targeting', () => {
    let mockListeners = [];

    beforeEach(() => {
        document.body.innerHTML = '';
        
        // --- Full Mock Setup for content.js ---
        global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
        window.matchMedia = () => ({ 
            matches: false,
            addEventListener: () => {}
        });
        
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: (fn) => {
                        mockListeners.push(fn);
                    }
                },
                sendMessage: (msg, cb) => {
                    if (cb) cb({});
                    return Promise.resolve({});
                }
            },
            storage: {
                local: {
                    get: (keys, cb) => { if (cb) cb({}); },
                    set: (data, cb) => { if (cb) cb(); }
                },
                onChanged: {
                    addListener: () => {}
                }
            }
        };

        global.MutationObserver = class {
            constructor(callback) {}
            disconnect() {}
            observe(element, initObject) {}
        };

        const contentScriptPath = path.resolve(__dirname, './content.js');
        let code = fs.readFileSync(contentScriptPath, 'utf8');
        
        // Skip the waitForElement block so init() proceeds synchronously in JSDOM
        code = code.replace(
            'const targetDiv = await waitForElement(targetXPath);',
            'const targetDiv = document.body;'
        );
        
        try {
            eval(code);
        } catch(e) {
            console.error("Eval error:", e);
        }
    });

    afterEach(() => {
        mockListeners = [];
        delete global.chrome;
        delete global.MutationObserver;
    });

    function sendOptimisticMessage(msg) {
        mockListeners.forEach(listener => listener(msg, {}, () => {}));
    }

    test('1. Ambiguous Scale - 1st Update does nothing (msg.eventId is missing)', () => {
        document.body.innerHTML = `
            <div role="gridcell" data-datekey="20001">
                <div class="rGFpCd">
                    <div class="NlWrkb snByac" style="top: 100px; height: 30px;" data-eventid="bWFzdGVyMTIzXzIwMjYwNzI0VDA4MDAwMFogY2FsZW5kYXJJZA==">
                        <span class="gVNoLb">09:00 - 09:30</span>
                        <span class="Wq3yec">ráno</span>
                    </div>
                </div>
            </div>
            <div role="gridcell" data-datekey="20003">
                <div class="rGFpCd">
                    <div class="NlWrkb snByac" style="top: 200px; height: 30px;" data-eventid="bWFzdGVyMTIzXzIwMjYwNzI2VDA4MDAwMFogY2FsZW5kYXJJZA==">
                        <span class="gVNoLb">10:00 - 10:30</span>
                        <span class="Wq3yec">ráno</span>
                    </div>
                </div>
            </div>
        `;

        sendOptimisticMessage({
            type: 'optimisticUpdate',
            opId: 'op1',
            action: 'scale',
            title: 'ráno',
            hasTime: false,
            hasDate: false
        });

        const blocks = document.querySelectorAll('.NlWrkb');
        expect(blocks[0].style.height).toBe('30px');
        expect(blocks[1].style.height).toBe('30px');
    });

    test('2. Ambiguous Scale - 2nd Update targets correct element using targetStart fallback', () => {
        const targetDate = new Date(2026, 6, 24, 9, 10); 
        const parsedTarget = new Date(targetDate.toISOString());
        const expectedTop = (parsedTarget.getHours() + (parsedTarget.getMinutes() / 60)) * 60 - 1;
        
        document.body.innerHTML = `
            <header>
                <button data-datekey="20001">24</button>
                <button data-datekey="20003">26</button>
            </header>
            <div role="gridcell" data-datekey="20001">
                <div class="rGFpCd">
                    <div class="NlWrkb snByac" style="top: ${expectedTop}px; height: 30px;" data-eventid="bWFzdGVyMTIzXzIwMjYwNzI0VDA4MDAwMFogY2FsZW5kYXJJZA==">
                        <span class="gVNoLb">09:10 - 09:40</span>
                        <span class="Wq3yec">ráno</span>
                    </div>
                </div>
            </div>
            <div role="gridcell" data-datekey="20003">
                <div class="rGFpCd">
                    <div class="NlWrkb snByac" style="top: ${expectedTop + 60}px; height: 30px;" data-eventid="bWFzdGVyMTIzXzIwMjYwNzI2VDA4MDAwMFogY2FsZW5kYXJJZA==">
                        <span class="gVNoLb">10:10 - 10:40</span>
                        <span class="Wq3yec">ráno</span>
                    </div>
                </div>
            </div>
        `;

        sendOptimisticMessage({
            type: 'optimisticUpdate',
            opId: 'op2',
            action: 'scale',
            title: 'ráno',
            eventId: 'master123_20260724T080000Z', 
            targetStart: targetDate.toISOString(), 
            newStart: targetDate.toISOString(),
            newEnd: new Date(parsedTarget.getTime() + 3600000).toISOString(),
            newDurationMs: 3600000 
        });

        const blocks = document.querySelectorAll('.NlWrkb');
        expect(blocks[0].style.height).toBe('58px');
        expect(blocks[1].style.height).toBe('30px');
    });

    test('3. Create - Appends cloned element to correct column', () => {
        document.body.innerHTML = `
            <header>
                <button data-datekey="30005">15</button>
            </header>
            <div role="gridcell" data-datekey="30005">
                <div class="rGFpCd">
                    <!-- Target column is empty initially except for container -->
                </div>
            </div>
            <div role="gridcell" data-datekey="30000">
                <div class="rGFpCd">
                    <div class="NlWrkb snByac" style="top: 100px;" data-eventid="dummy">
                        <!-- Template block to clone -->
                    </div>
                </div>
            </div>
        `;

        const targetDate = new Date(2026, 6, 15, 14, 30);
        const parsedTarget = new Date(targetDate.toISOString());
        const expectedTop = (parsedTarget.getHours() + (parsedTarget.getMinutes() / 60)) * 60 - 1;

        sendOptimisticMessage({
            type: 'optimisticUpdate',
            opId: 'op3',
            action: 'create',
            title: 'New Event',
            hasTime: true,
            hasDate: true,
            newStart: targetDate.toISOString(),
            newEnd: new Date(parsedTarget.getTime() + 3600000).toISOString(),
            backgroundColor: '#4285f4'
        });

        const targetCol = document.querySelector('div[data-datekey="30005"] .rGFpCd');
        expect(targetCol.children.length).toBe(1);
        
        const newBlock = targetCol.children[0];
        
        expect(newBlock.style.top).toBe(`${expectedTop}px`);
        expect(newBlock.style.height).toBe('58px');
    });

    test('4. Delete - Hides target element', () => {
        document.body.innerHTML = `
            <div role="gridcell" data-datekey="10001">
                <div class="rGFpCd">
                    <div class="NlWrkb snByac" id="targetDelete" data-eventid="bWFzdGVyMTIzXzIwMjYwNzI0VDA4MDAwMFogY2FsZW5kYXJJZA==">
                        <span class="Wq3yec">delete me</span>
                    </div>
                </div>
            </div>
        `;

        sendOptimisticMessage({
            type: 'optimisticUpdate',
            opId: 'op4',
            action: 'delete',
            title: 'delete me',
            eventId: 'master123_20260724T080000Z'
        });

        const target = document.getElementById('targetDelete');
        expect(target.dataset.optimisticDeleted).toBe("true");
        expect(target.style.display).toBe("none");
    });
});
