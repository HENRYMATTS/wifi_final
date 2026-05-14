/* This software is licensed under the MIT License: https://github.com/spacehuhntech/esp8266_deauther */

var probeData = [];      // each entry: { mac, ssid, channel, rssi, count, selected }
var countdownInterval = null;
var duts;
var elxtime;

// Key for localStorage
var STORAGE_KEY = "probeSelectedSSIDs";

// Save selected SSIDs to localStorage (only non‑empty ones that are selected)
function saveSelectedToStorage() {
    var selected = probeData.filter(function(entry) {
        return entry.selected && entry.ssid && entry.ssid !== "";
    }).map(function(entry) {
        return entry.ssid;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
}

// Load selected SSIDs from localStorage and apply to probeData
function loadSelectedFromStorage() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
        var selectedSSIDs = JSON.parse(stored);
        if (!Array.isArray(selectedSSIDs)) return;
        for (var i = 0; i < probeData.length; i++) {
            var entry = probeData[i];
            if (entry.ssid && entry.ssid !== "") {
                entry.selected = selectedSSIDs.indexOf(entry.ssid) !== -1;
            } else {
                entry.selected = false;
            }
        }
    } catch(e) {}
}

// Remove a single probe entry by index
function removeProbeEntry(index) {
    if (index < 0 || index >= probeData.length) return;
    var removed = probeData.splice(index, 1);
    drawProbeTable();
    if (removed[0] && removed[0].selected && removed[0].ssid && removed[0].ssid !== "") {
        saveSelectedToStorage();
    }
}

// Remove all probe entries (no confirmation prompt)
function removeAllProbes() {
    probeData = [];
    drawProbeTable();
    localStorage.removeItem(STORAGE_KEY);
    getFile("run?cmd=delete /probe.json");
}

// Remove all selected probe entries
function removeSelectedProbes() {
    var newData = [];
    for (var i = 0; i < probeData.length; i++) {
        if (!probeData[i].selected) {
            newData.push(probeData[i]);
        }
    }
    probeData = newData;
    drawProbeTable();
    saveSelectedToStorage();
    // Note: we do not delete the backend file here – it will be overwritten on next scan.
    // If you want immediate backend sync, you could send a custom command, but typically not needed.
}

// Select / deselect all probes (only those with non‑empty SSID)
function selectAllProbes(select) {
    for (var i = 0; i < probeData.length; i++) {
        if (probeData[i].ssid && probeData[i].ssid !== "") {
            probeData[i].selected = select;
        }
    }
    drawProbeTable();
    saveSelectedToStorage();
}

// Toggle selection of a single probe
function toggleProbeSelection(index) {
    if (index < 0 || index >= probeData.length) return;
    var entry = probeData[index];
    if (entry.ssid && entry.ssid !== "") {
        entry.selected = !entry.selected;
        drawProbeTable();
        saveSelectedToStorage();
    }
}

function drawProbeTable() {
    var html = "";
    if (!probeData || probeData.length === 0) {
        html = "<tr><td colspan='9'>No probe requests detected.</td></tr>";
    } else {
        html = "<table>"
            + "<th class='id'></th>"
            + "<th class='mac'>MAC</th>"
            + "<th class='ssid'>SSID</th>"
            + "<th class='ch'>Ch</th>"
            + "<th class='rssi'>RSSI</th>"
            + "<th class='count'>Count</th>"
            + "<th class='vendor'>Vendor</th>"
            + "<th class='selectColumn'></th>"
            + "<th class='remove'></th>"
            + "</tr>";

        for (var i = 0; i < probeData.length; i++) {
            var entry = probeData[i];
            var ssid = entry.ssid || "";
            var displaySsid = ssid === "" ? "(empty)" : esc(ssid);
            var hasSsid = (ssid !== "");
            var rowClass = (hasSsid && entry.selected) ? "class='selected'" : "";

            // RSSI meter (identical to scan.js)
            var width = entry.rssi + 130;
            var color;
            if (width < 50) color = "meter_red";
            else if (width < 70) color = "meter_orange";
            else color = "meter_green";
            var rssiHtml = "<td class='rssi'><div class='meter_background'>" +
                           "<div class='meter_forground " + color + "' style='width:" + width + "%;'>" +
                           "<div class='meter_value'>" + entry.rssi + "</div></div></div></td>";

            // Select column: only if SSID non-empty
            var selectCell = "";
            if (hasSsid) {
                var checkedAttr = entry.selected ? "checked" : "";
                selectCell = "<label class='checkBoxContainer'>" +
                             "<input type='checkbox' " + checkedAttr + " onclick='toggleProbeSelection(" + i + ")'>" +
                             "<span class='checkmark'></span></label>";
            }
            // Remove column: only if SSID non-empty
            var removeCell = "";
            if (hasSsid) {
                removeCell = "<button class='red' onclick='removeProbeEntry(" + i + ")'>X</button>";
            }

            html += "<tr " + rowClass + ">"
                + "<td class='id'>" + i + "</td>"
                + "<td class='mac'>" + esc(entry.mac) + "</td>"
                + "<td class='ssid'>" + displaySsid + "</td>"
                + "<td class='ch'>" + entry.channel + "</td>"
                + rssiHtml
                + "<td class='count'>" + entry.count + "</td>"
                + "<td class='vendor'>" + esc(entry.vendor || "") + "</td>"
                + "<td class='selectColumn'>" + selectCell + "</td>"
                + "<td class='remove'>" + removeCell + "</td>"
                + "</tr>";
        }
        html += "</table>";
    }
    getE("apTable").innerHTML = html;
    getE("apNum").innerHTML = probeData.length;
}

function scan(type) {
    getE('RButton').disabled = true;
    getE('scanZero').disabled = true;
    getE('scanZero').style.visibility = 'hidden';
    
    if (countdownInterval) clearInterval(countdownInterval);
    
    var countdownElement = getE("countdownDisplay");
    var scanTimeSeconds = parseInt(getE("scanTime").value);
    if (isNaN(scanTimeSeconds)) scanTimeSeconds = 15;
    var channel = getE("ch").options[getE("ch").selectedIndex].value;
    
    var remaining = scanTimeSeconds;
    countdownElement.style.display = "inline-block";
    countdownElement.innerText = remaining + "s";
    countdownInterval = setInterval(function() {
        remaining--;
        if (remaining <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            countdownElement.innerText = "0s";
        } else {
            countdownElement.innerText = remaining + "s";
        }
    }, 1000);
    
    probeData = [];
    drawProbeTable();
    showMessage("LOADING");
    
    var cmdStr = "scan probe -t " + scanTimeSeconds + "s -ch " + channel;
    getFile("run?cmd=" + cmdStr);
    duts = 0;
    elxtime = scanTimeSeconds * 1000 + 1500;
    setTimeout(buttonFunc, elxtime);
    setTimeout(load, elxtime);
}

function buttonFunc() {
    getE('scanZero').style.visibility = 'visible';
    getE('scanZero').disabled = false;
    getE('RButton').disabled = false;
}

function load() {
    // Step 1: Test connectivity with a lightweight command
    getFile("run?cmd=help", function() {
        // Step 2: Try to read probe.json, but handle 404 as empty data
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/probe.json", true);
        xhr.timeout = 5000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                // File exists – parse and load data
                try {
                    var raw = JSON.parse(xhr.responseText);
                    probeData = raw.map(function(entry) {
                        entry.selected = false;
                        return entry;
                    });
                    loadSelectedFromStorage();
                    showMessage("connected");
                    drawProbeTable();
                } catch(e) {
                    console.error("Error parsing probe.json", e);
                    showMessage("ERROR: Invalid JSON");
                }
            } else if (xhr.status === 404) {
                // File doesn't exist – treat as empty list
                probeData = [];
                drawProbeTable();
                showMessage("connected");  // still connected, just no data yet
            } else {
                // Other HTTP error
                showMessage("ERROR: Could not load probe.json (HTTP " + xhr.status + ")");
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            getE("countdownDisplay").style.display = "none";
        };
        xhr.onerror = function() {
            showMessage("ERROR: Failed to load probe.json");
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            getE("countdownDisplay").style.display = "none";
        };
        xhr.ontimeout = function() {
            showMessage("ERROR: Timeout loading probe.json");
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            getE("countdownDisplay").style.display = "none";
        };
        xhr.send();
    });
}

window.addEventListener('load', function() {
    setTimeout(load, 100);
});