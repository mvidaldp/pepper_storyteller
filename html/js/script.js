/* eslint-disable indent */
/* eslint semi: ["error", "always"] */
/** TODO:
 * - Clean chained promises
 * !- To change touch view scale factor to 1.0 (1.34 is the default): http://doc.aldebaran.com/2-5/naoqi/core/altabletservice-api.html#ALTabletService::setOnTouchWebviewScaleFactor__float
 * !- To open the tablet settings, run this while connected to the robot via ssh: qicli call ALTabletService._openSettings
 */

'use strict'; // allow ES6 features like let and const

// console.log('User Agent:' + navigator.userAgent);
// output: User Agent:Mozilla/5.0 (Linux; Android 5.1; LPT_200AR Build/LMY47I) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.157 Crosswalk/15.44.384.6 Safari/537.36

// Initialization
// eslint-disable-next-line no-undef
const qiSession = new QiSession();
const services = new Services(qiSession);
const cStatus = new CurrentStatus();

// DOM Elements
const banner = document.getElementById('banner');
const btnClose = document.getElementById('btn-close'); // for debugging
const btnStartTalk = document.getElementById('btn-start-talk');
const startContent = document.getElementById('start-content');
const talkingContent = document.getElementById('talking-content');
const currentPhrase = document.getElementById('current-phrase');
const talkingImage = document.getElementById('talking-image');

// Global Variables
let SENTENCES = [];
let ATT_CALLS = [];
let CALLS = [];
const MIN_CALL_TIME = 20000;
const MAX_CALL_TIME = 60000;
const ASAY_CONF = {
    bodyLanguageMode: 'contextual'
};
let TTSPARAMS = {
    speed: 90.0,
    pitchShift: 1.15
};

// Define all degrees, colors, sides, etc. for the LEDs to turn on
const PREFIX = 'Face/Led'; // eyes' LED prefix
const COLORS = ['Red', 'Green', 'Blue']; // basic colors, no HEX colors
const SIDES = ['Left', 'Right']; // left and right eyes
const DEGREES = [0, 45, 90, 135, 180, 225, 270, 315];
const SUFIX = 'Deg/Actuator/Value'; // eyes' LED sufix
// Create dictionary to hold all eyes LEDs by color
const LEDS = {};
// for each color
for (const color of COLORS) {
    const leds = [];
    // for each degree
    for (const degree of DEGREES) {
        // for each side
        for (const side of SIDES) {
            leds.push(`${PREFIX}/${color}/${side}/${degree}${SUFIX}`);
        }
    }
    LEDS[color] = leds;
}

// Classes
/**
 * Class representing various services provided by the current QiSession.
 * @param {QiSession} session - The current QiSession instance.
 * @property {object} memory - Service for accessing memory data.
 * @property {object} tts - Service for text-to-speech functionality.
 * @property {object} aSay - Service for animated speech.
 * @property {object} behavior - Service for managing robot behaviors.
 * @property {object} awareness - Service for basic awareness functionality.
 * @property {object} motion - Service for controlling robot motion.
 * @property {object} LEDs - Service for controlling LEDs on the robot.
 * @property {object} peoplePerception - Service for detecting people.
 */
function Services (session) {
    this.memory = session.service('ALMemory');
    this.tts = session.service('ALTextToSpeech');
    this.aSay = session.service('ALAnimatedSpeech');
    this.behavior = session.service('ALBehaviorManager');
    this.awareness = session.service('ALBasicAwareness');
    this.blinking = session.service('ALAutonomousBlinking');
    this.motion = session.service('ALMotion');
    this.LEDs = session.service('ALLeds');
    this.peoplePerception = session.service('ALPeoplePerception');
    this.faceDetection = session.service('ALFaceDetection');
}

/**
 * Class representing the current status of TTS and media for the robot.
 * @class
 * @property {boolean} animated - Indicates whether animations are enabled for the robot.
 * @property {boolean} speaking - Indicates if the robot is currently speaking.
 * @property {boolean} talk - Indicates if the robot is giving the talk.
 * @property {boolean} calling - Indicates if the robot is calling the atteniton.
 * @property {boolean} canCall - Indicates if the robot is allowed to call the atteniton.
 * @property {boolean} modLEDs - Indicates whether the LEDs have been modified.
 * @property {boolean} startBtnClicked - Indicates whether the start button has been clicked.
 * @property {number} senIdx - Index of the current sentence being spoken.
 * @property {number} senIdx - Index of the current attention call being spoken.
 */
function CurrentStatus () {
    this.animated = true;
    this.speaking = false;
    this.talk = false;
    this.calling = false;
    this.modLEDs = false;
    this.startBtnClicked = false;
    this.senIdx = 0;
    this.callIdx = 0;
}

/** Helper function to execute a callback function when the DOM is ready.
 * @param {Function} cb - Callback function to execute when the DOM is ready.
 */
function domReady (cb) {
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        cb();
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            cb();
        });
    }
}

/**
 * Prevents base movement of the robot.
 * @returns {Promise} A Promise that resolves when base movement is prevented.
 */
function preventBaseMovement () {
    return services.awareness.then(function (awareness) {
        return Promise.all([
            awareness.setEngagementMode('SemiEngaged'), // default 'Unengaged'
            awareness.setTrackingMode('Head')
        ]);
    });
}

/**
 * Disables the face recognition of the robot (pink eyes with shadow).
 * @returns {Promise} A Promise that resolves when face recognition is disabled.
 */
function disableFaceRecognition () {
    return services.faceDetection.then(function (faceDetection) {
        return faceDetection.setRecognitionEnabled(false);
    });
}

/**
 * Wakes up or rests the robot based on the animated status.
 */
function wakeUpOrRest () {
    services.motion.then(function (motion) {
        // Call wakeUp() if cStatus.animated is true, otherwise call rest()
        cStatus.animated ? motion.wakeUp() : motion.rest();
    });
}

/**
 * Creates a selected group of LEDs based on the specified color.
 * @param {string} color - The color for which the group of LEDs is created.
 * @returns {Array} An array of selected LEDs based on the specified color.
 */
function createSelectedGroup (color) {
    let selectedLEDs = [];
    const hasRed = color.includes('R');
    const hasGreen = color.includes('G');
    const hasBlue = color.includes('B');
    // if all three colors are set, group nothing (white), plus there's allLEDs
    if (!(hasRed && hasGreen && hasBlue)) {
        if (hasRed) selectedLEDs = selectedLEDs.concat(LEDS.Red);
        if (hasGreen) selectedLEDs = selectedLEDs.concat(LEDS.Green);
        if (hasBlue) selectedLEDs = selectedLEDs.concat(LEDS.Blue);
    }
    return selectedLEDs;
}

/**
 * Creates a group of LEDs with the specified name for the LEDs service.
 * @param {string} name - The name of the group.
 * @param {Array} group - An array of LEDs to be included in the group.
 * @returns {Promise} A Promise that resolves when the group is created.
 */
function createGroup (name, group) {
    return services.LEDs.then(function (leds) {
        return leds.createGroup(name, group);
    });
}

/**
 * Disable autonomous blinking when enabled.
 * @returns {Promise} A Promise that resolves when blinking is disabled.
 */
function disableBlinking () {
    return services.blinking.then(function (blinking) {
        if (blinking.isEnabled) return blinking.setEnabled(false);
    });
}

/**
 * Enable autonomous blinking
 * @returns {Promise} A Promise that resolves when blinking is enabled.
 */
function enableBlinking () {
    return services.blinking.then(function (blinking) {
        return blinking.setEnabled(true);
    });
}

/**
 * Changes the state of the selected LEDs to ON.
 * @returns {Promise} A Promise that resolves when the LEDs are changed.
 */
function changeLEDs () {
    // disable autonomous blinking before changing LEDs
    return services.LEDs.then(function (leds) {
        // switch off all eyes LEDs
        return leds.off('FaceLeds')
            .then(function () {
                // switch on the selected LEDs
                return leds.on('selectedLEDs');
            })
            .then(function () {
                cStatus.modLEDs = true;
                return Promise.resolve();
            });
    });
}

/**
 * Resets all eyes' LEDs to their default state.
 * @returns {Promise} A Promise that resolves when the LEDs are reset.
 */
function resetLEDs () {
    return services.LEDs.then(function (leds) {
        // switch on the selected LEDs
        return leds.reset('FaceLeds');
    }).then(function () {
        cStatus.modLEDs = false;
        return Promise.resolve();
    });
}

/**
 * Sets the language parameters for TTS.
 * @param {object} ttsparams - The TTS parameters including language, speed, and pitch shift.
 * @returns {Promise} A Promise that resolves when the language parameters are set.
 */
function setLangParams (ttsparams) {
    return services.tts.then(function (tts) {
        // Set language first
        return tts.setLanguage(ttsparams.language)
            .then(function () {
                // Once language is set, set pitchShift parameter
                return tts.setParameter('pitchShift', ttsparams.pitchShift);
            })
            .then(function () {
                // Once pitchShift parameter is set, set speed parameter
                return tts.setParameter('speed', ttsparams.speed);
            });
    });
}

/**
 * Handles the current sentence event from TTS.
 * @param {string} sentence - The current sentence being spoken.
 */
function currentSentence (sentence) {
    if (sentence && cStatus.talk) {
        if (sentence.indexOf('Asta') !== -1) sentence = sentence.replace(/Asta/g, 'Hasta');
        currentPhrase.innerText = sentence;
        console.log(`Current sentence: ${sentence}`);
    }
}

/**
 * Subscribes to the PeoplePerception/PeopleDetected event.
 * @returns {Promise} A Promise that resolves when the subscription is established.
 */
function subscribePeoplePerception () {
    return services.memory.then(function (memory) {
        return memory.subscriber('PeoplePerception/PeopleDetected').then(function (evt) {
            return evt.signal.connect(callAttention);
        });
    });
}

/**
 * Subscribes to TTS signals such as ALTextToSpeech/Status, ALTextToSpeech/TextDone, ALTextToSpeech/CurrentSentence.
 * @returns {Promise} A Promise that resolves when all subscriptions are established.
 */
function subscribeTTSSignals () {
    return services.memory
        .then(function (memory) {
            return Promise.all([
                memory.subscriber('ALTextToSpeech/Status').then(function (evt) {
                    return evt.signal.connect(talkingStatus);
                }),
                memory.subscriber('ALTextToSpeech/TextDone').then(function (evt) {
                    return evt.signal.connect(giveTalk);
                }),
                memory.subscriber('ALTextToSpeech/CurrentSentence').then(function (evt) {
                    return evt.signal.connect(currentSentence);
                })
            ]);
        });
}

/**
 * Stops all TTS tasks.
 * @returns {Promise} A Promise that resolves when TTS tasks are stopped.
 */
function stopTTS () {
    return services.tts.then(function (tts) {
        return tts.stopAll();
    });
}

/**
 * Toggles the visibility of the start content.
 */
function toggleStartContent () {
    startContent.classList.toggle('visible');
    startContent.classList.toggle('invisible');

    talkingContent.classList.toggle('visible');
    talkingContent.classList.toggle('invisible');
}

/**
 * Toggles the visibility of the banner.
 */
function toggleBanner () {
    banner.classList.toggle('visible');
    banner.classList.toggle('invisible');
}

/**
 * Toggles the visibility of the talking image.
 */
function toggleTalkingImage () {
    talkingImage.classList.toggle('visible');
    talkingImage.classList.toggle('invisible');
}

/**
 * Gets the attention calls data from memory.
 * @returns {Promise} A Promise that resolves with the attention calls data.
 */
function getAttCallsData () {
    return services.memory.then(function (memory) {
        return memory.getData('attcallsData');
    });
}

/**
 * Gets the talk data from memory.
 * @param {boolean} defTalk - Indicates whether to retrieve default talk data.
 * @returns {Promise} A Promise that resolves with the talk data.
 */
function getTalkData (defTalk) {
    return services.memory.then(function (memory) {
        let defaultSentences = 'talkData';
        if (!defTalk) defaultSentences = 'talkData_alt';
        return memory.getData(defaultSentences);
    });
}

/**
 * Parses CSV data and creates an array of Sentence objects.
 * @param {string} csvData - The CSV data to be parsed.
 * @returns {Array} An array of Sentence objects.
 */
function parseCSVData (csvData) {
    const sentences = [];
    const lines = csvData.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const parts = parseCSVLine(lines[i]);
        const sentence = {};
        if (parts.length >= 8) {
            sentence.sentence = parts[0].trim();
            sentence.image = parts[1].trim();
            sentence.animated = (parts[2].trim() === 'TRUE');
            sentence.pauseTime = parseInt(parts[3].trim());
            sentence.language = parts[4].trim();
            sentence.speed = parseFloat(parts[5].trim());
            sentence.pitchShift = parseFloat(parts[6].trim());
            sentence.eyesColor = parts[7].trim();
            sentences.push(sentence);
        } else if (parts.length >= 5) {
            sentence.sentence = parts[0].trim();
            sentence.language = parts[1].trim();
            sentence.speed = parseFloat(parts[2].trim());
            sentence.pitchShift = parseFloat(parts[3].trim());
            sentence.eyesColor = parts[4].trim();
            sentences.push(sentence);
        }
    }
    return sentences;
}

/**
 * Parses a single line of CSV data.
 * @param {string} line - The CSV line to be parsed.
 * @returns {Array} An array of parts extracted from the CSV line.
 */
function parseCSVLine (line) {
    const parts = [];
    let currentPart = '';
    let insideQuote = false;
    for (const char of line) {
        if (char === '"') insideQuote = !insideQuote;
        else if (char === ',' && !insideQuote) {
            parts.push(currentPart);
            currentPart = '';
        } else currentPart += char;
    }
    parts.push(currentPart);
    return parts;
}

/**
 * Checks which talk data to load based on the default talk value.
 * @returns {Promise} A Promise that resolves with the default talk value.
 */
function defaultTalk () {
    return fetch('http://192.168.1.2:3001/is_default_talk')
        .then(function (response) {
            if (response.ok) return response.json();
            else return true; // set default talk if network response not okay
        })
        .then(function (data) {
            return data.isDefaultTalk;
        })
        .catch(function (error) {
            console.error('Error fetching default talk value:', error);
            return true; // set default talk if URL not available
        });
}

/**
 * Loads sentences based on the default talk value.
 * @param {boolean} isDefaultTalk - Indicates whether to load default talk data.
 */
function loadSentences (isDefaultTalk) {
    getTalkData(isDefaultTalk)
        .then(function (talkData) {
            SENTENCES = parseCSVData(talkData);
            toggleStartTalking();
            cStatus.startBtnClicked = true;
            cStatus.talk = true;
            cStatus.speaking = false;
            cStatus.calling = false;
            cStatus.senIdx = 0;
            giveTalk();
        })
        .catch(function (error) {
            console.error('Error:', error);
            // if it fails, log the error and continue with the default data
            return getTalkData(true);
        });
}

/**
 * Makes Pepper speak out the text string provided.
 * @param {boolean} give - Indicates whether to continue giving talk.
 */
function giveTalk (give) {
    // Pepper's JS is from 2015, so no default parameters allowed, thus
    if (arguments.length === 0) give = true; // Default value
    if (cStatus.senIdx < SENTENCES.length && give && cStatus.talk) {
        const currSenData = SENTENCES[cStatus.senIdx]; // Define currSenData here
        // Construct the sentence with pause time
        const sentence = `\\pau=${currSenData.pauseTime}\\${currSenData.sentence}`;
        const imgFile = currSenData.image;
        TTSPARAMS = {
            language: currSenData.language,
            speed: currSenData.speed,
            pitchShift: currSenData.pitchShift
        };
        // Say the sentence using services.aSay
        services.aSay.then(function (aSay) {
            talkingImage.src = `img/${imgFile}`;
            // Update cStatus.animated if it's different from currSenData.animated
            if (cStatus.animated !== currSenData.animated) {
                cStatus.animated = currSenData.animated;
                wakeUpOrRest();
            }
            // Call the function to create a selected LEDs eyes group
            const selectedLEDs = createSelectedGroup(currSenData.eyesColor);
            if (selectedLEDs.length > 0) {
                createGroup('selectedLEDs', selectedLEDs)
                    .then(function () {
                        disableBlinking();
                    })
                    .then(function () {
                        changeLEDs();
                    });
            } else if (cStatus.modLEDs) {
                resetLEDs()
                    .then(function () {
                        enableBlinking();
                    });
            }
            setLangParams(TTSPARAMS)
                .then(function () {
                    aSay.say(`\\style=didactic\\ ${sentence}`, ASAY_CONF);
                });
        });
        cStatus.senIdx++; // Move to the next sentence index
    }
}

/**
 * Toggles the disabled state of the start talk button.
 */
function toggleButton () {
    btnStartTalk.disabled = !btnStartTalk.disabled;
    // same as btnStartTalk.disabled ? false : true
}

/**
 * Toggles the background color between black overlay and white background.
 */
function toggleBackground () {
    document.body.classList.toggle('black-overlay');
}

/**
 * Toggles between the start content and talking content.
 */
function toggleStartTalking () {
    toggleBackground();
    toggleBanner();
    toggleButton();
    toggleStartContent();
    toggleTalkingImage();
}

/**
 * Click event listener for the start talk button.
 */
btnStartTalk.addEventListener('click', function () {
    // Check if the button has already been clicked
    if (!cStatus.startBtnClicked && !cStatus.speaking) {
        // Disable the start button to prevent multiple clicks
        btnStartTalk.disabled = true;
        // Check if the robot is currently calling attention
        defaultTalk()
            .then(function (isDefaultTalk) {
                loadSentences(isDefaultTalk);
            }).catch(function (error) {
                console.error('Error:', error);
                // Handle the error if necessary
            });
    }
});

/**
 * Click event listener for the close button (debug purposes only).
 */
btnClose.addEventListener('click', function () {
    stopTTS()
        .then(function (memory) {
            return memory.getData('packageUid')
                .then(function (uid) {
                    const packageUid = uid;
                    return memory.getData('behaviorUid')
                        .then(function (uid) {
                            const behaviorUid = uid;
                            return services.behavior.then(function (behavior) {
                                // console.log(`${packageUid}/${behaviorUid}`)
                                // in this case it should give us industriekultur_expo_24/webview
                                return behavior.stopBehavior(`${packageUid}/${behaviorUid}`);
                            });
                        });
                });
        })
        .catch(function (error) {
            // Handle errors if any of the promises fail
            console.error('Error:', error);
        });
});

/**
 * Shuffle an array using Fisher-Yates shuffle algorithm.
 */
function shuffleArray (array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)); // Generate random index
        const temp = array[i]; // Store the current element in a temporary variable
        array[i] = array[j]; // Assign the value of array[j] to array[i]
        array[j] = temp; // Assign the value of the temporary variable to array[j]
    }
    return array;
}

/**
 * Handles the talking status of the robot.
 * @param {Array} value - An array containing the current TTS task ID and status.
 */
function talkingStatus (value) {
    // let ttsID = value[0];
    const status = value[1];
    if (status === 'enqueued') cStatus.speaking = true;
    else if (cStatus.talk && (status === 'done' || status === 'stopped')) {
        cStatus.speaking = false;
        if (cStatus.senIdx === SENTENCES.length) cStatus.senIdx++; // Move to the next sentence index
        else if (cStatus.senIdx === SENTENCES.length + 1) {
            stopTTS()
                .then(function () {
                    resetLEDs();
                })
                .then(function () {
                    enableBlinking();
                })
                .then(function () {
                    toggleStartTalking();
                    cStatus.startBtnClicked = false;
                    btnStartTalk.disabled = false;
                    cStatus.talk = false;
                    cStatus.senIdx = 0;
                    currentPhrase.innerText = '';
                    startRandomInterval();
                });
        }
    } else if (!cStatus.talk && (status === 'done' || status === 'stopped')) {
        cStatus.speaking = false;
        cStatus.callIdx++;
        resetLEDs().then(function () {
            enableBlinking();
        });
        if (cStatus.callIdx === CALLS.length) {
            stopTTS()
                .then(function () {
                    resetLEDs().then(function () {
                        enableBlinking();
                    });
                })
                .then(function () {
                    cStatus.callIdx = 0;
                    // deepcopy and reshuffle the attention calls
                    CALLS = shuffleArray(JSON.parse(JSON.stringify(ATT_CALLS)));
                    startRandomInterval();
                });
        }
        startRandomInterval();
    }
}

/**
 * Function to start a random timeout to allow calling the attention.
 */
function startRandomInterval () {
    if (!cStatus.calling && !cStatus.talk && !cStatus.speaking) {
        const interval = Math.floor(Math.random() * (MAX_CALL_TIME - MIN_CALL_TIME + 1)) + MIN_CALL_TIME;
        // Set timeout to call myFunction in milliseconds
        setTimeout(toggleCalling, interval);
    }
}

/**
 * Toggle calling boolean value.
 */
function toggleCalling () {
    if (!cStatus.talk && !cStatus.speaking) {
        cStatus.calling = !cStatus.calling;
        startRandomInterval();
    }
}

/**
 * Calls attention to the robot when a person is detected.
 */
function callAttention () {
    if (!cStatus.talk && cStatus.calling && !cStatus.speaking) {
        cStatus.calling = false;
        const currCallData = CALLS[cStatus.callIdx];
        const call = currCallData.sentence;
        TTSPARAMS = {
            language: currCallData.language,
            speed: currCallData.speed,
            pitchShift: currCallData.pitchShift
        };
        // Call the function to create a selected LEDs eyes group
        const selectedLEDs = createSelectedGroup(currCallData.eyesColor);
        if (selectedLEDs.length > 0) {
            // disable autonomous blinking before changing LEDs
            createGroup('selectedLEDs', selectedLEDs)
                .then(function () {
                    disableBlinking();
                })
                .then(function () {
                    changeLEDs();
                });
        } else if (cStatus.modLEDs) {
            resetLEDs()
                .then(function () {
                    enableBlinking();
                });
        }
        services.aSay.then(function (aSay) {
            setLangParams(TTSPARAMS)
                .then(function () {
                    aSay.say(`\\style=didactic\\ ${call}`, ASAY_CONF);
                });
        });
    }
}

/**
 * Callback function for the DOM ready event.
 */
domReady(function () {
    return preventBaseMovement()
        .then(function () {
            return disableFaceRecognition();
        })
        .then(function () {
            return getAttCallsData();
        })
        .then(function (attCallsData) {
            // read attention calls from memory, parse and shuffle them
            ATT_CALLS = shuffleArray(parseCSVData(attCallsData));
            // deepcopy it
            CALLS = JSON.parse(JSON.stringify(ATT_CALLS));
            return subscribeTTSSignals()
                .then(function () {
                    return subscribePeoplePerception()
                        .then(function () {
                            startRandomInterval();
                            document.body.style.visibility = 'visible';
                        });
                });
        });
});
