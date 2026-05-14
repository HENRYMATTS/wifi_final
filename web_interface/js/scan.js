/* This software is licensed under the MIT License: https://github.com/spacehuhntech/esp8266_deauther */

var nameJson = [];
var scanJson = { aps: [], stations: [] };
var countdownInterval = null;
var stationFilterActive = false;      // whether to filter stations
var filteredStationIndices = [];       // indices of stations that belong to selected AP
var sniffActive = false;


function setDeauthColor(value) {
    var span = getE("deauthCount");
    // Threshold: if value >= 10 → red, else green
    if (value >= 8) {
        span.style.color = "red";
    } else {
        span.style.color = "green";
    }
}

// Update station filter based on currently selected AP (exactly one)
function updateStationFilter() {
    // Find selected AP index (exactly one selected)
    var selectedApIndex = -1;
    for (var i = 0; i < scanJson.aps.length; i++) {
        if (scanJson.aps[i][7]) { // selected flag
            if (selectedApIndex === -1) {
                selectedApIndex = i;
            } else {
                // more than one selected -> no filter
                selectedApIndex = -2;
                break;
            }
        }
    }

    if (selectedApIndex >= 0) {
        stationFilterActive = true;
        filteredStationIndices = [];
        for (var i = 0; i < scanJson.stations.length; i++) {
            // station[5] holds the AP index it's associated with
            if (scanJson.stations[i][5] === selectedApIndex) {
                filteredStationIndices.push(i);
            }
        }
    } else {
        stationFilterActive = false;
        filteredStationIndices = [];
    }
}


function drawScan() {
	var html;
	var selected;
	var width;
	var color;
	var macVendor;

	// Access Points
	getE("apNum").innerHTML = scanJson.aps.length;
	html = "<tr>"
		+ "<th class='id'></th>"
		+ "<th class='ssid'>SSID</th>"
		+ "<th class='name'>Name</th>"
		+ "<th class='ch'>Ch</th>"
		+ "<th class='rssi'>RSSI</th>"
		+ "<th class='enc'>Enc</th>"
		+ "<th class='lock'></th>"
		+ "<th class='mac'>MAC</th>"
		+ "<th class='vendor'>Vendor</th>"
		+ "<th class='selectColumn'></th>"
		+ "<th class='remove'></th>"
		+ "</tr>";

	for (var i = 0; i < scanJson.aps.length; i++) {
		selected = scanJson.aps[i][scanJson.aps[i].length - 1];
		width = parseInt(scanJson.aps[i][3]) + 130;

		if (width < 50) color = "meter_red";
		else if (width < 70) color = "meter_orange";
		else color = "meter_green";

		html += (selected ? "<tr class='selected'>" : "<tr>")
			+ "<td class='id'>" + i + "</td>" // ID
			+ "<td class='ssid'>" + esc(scanJson.aps[i][0]) + "</td>" // SSID
			+ "<td class='name'>" + (scanJson.aps[i][1].length > 0 ? esc(scanJson.aps[i][1]) : "<button onclick='add(0," + i + ")'>" + lang("add") + "</button>") + "</td>" // Name
			+ "<td class='ch'>" + esc(scanJson.aps[i][2]) + "</td>" // Ch
			// RSSI
			+ "<td class='rssi'><div class='meter_background'> <div class='meter_forground " + color + "' style='width: " + width + "%;'><div class='meter_value'>" + scanJson.aps[i][3] + "</div></div> </div></td>"
			+ "<td class='enc'>" + esc(scanJson.aps[i][4]) + "</td>" // ENC
			+ "<td class='lock'>" + (scanJson.aps[i][4] == "-" ? "" : "&#x1f512;") + "</td>" // Lock Emoji
			+ "<td class='mac'>" + esc(scanJson.aps[i][5]) + "</td>" // MAC
			+ "<td class='vendor'>" + esc(scanJson.aps[i][6]) + "</td>" // Vendor
			// Select
			+ "<td class='selectColumn'><label class='checkBoxContainer'><input type='checkbox' " + (selected ? "checked" : "") + " onclick='selectRow(0," + i + "," + (selected ? "false" : "true") + ")'><span class='checkmark'></span></label></td>"
			+ "<td class='remove'><button class='red' onclick='remove(0," + i + ")'>X</button></td>" // Remove
			+ "</tr>";
	}

	getE("apTable").innerHTML = html;



	// Stations
	    // Stations – filtered by selected AP (if exactly one AP is selected)
    var displayCount = stationFilterActive ? filteredStationIndices.length : scanJson.stations.length;
    getE("stNum").innerHTML = displayCount;
    html = "<table>"
        + "<th class='id'></th>"
        + "<th class='vendor'>Vendor</th>"
        + "<th class='mac'>MAC</th>"
        + "<th class='ch'>Ch</th>"
        + "<th class='name'>Name</th>"
        + "<th class='pkts'>Pkts</th>"
        + "<th class='ap'>AP</th>"
        + "<th class='lastseen'>Last seen</th>"
        + "<th class='selectColumn'></th>"
        + "<th class='remove'></th>"
        + "</tr>";

    // Determine which stations to display (filtered or all)
    var displayIndices = stationFilterActive ? filteredStationIndices : [];
    if (!stationFilterActive) {
        displayIndices = [];
        for (var i = 0; i < scanJson.stations.length; i++) displayIndices.push(i);
    }

    for (var idx = 0; idx < displayIndices.length; idx++) {
        var i = displayIndices[idx];        // original index in scanJson.stations
        selected = scanJson.stations[i][scanJson.stations[i].length - 1];
        ap = "";
        if (scanJson.stations[i][5] >= 0 && scanJson.stations[i][5] < scanJson.aps.length)
            ap = esc(scanJson.aps[scanJson.stations[i][5]][0]);

        html += (selected ? "<tr class='selected'>" : "<tr>")
            + "<td class='id'>" + i + "</td>" // ID (original index)
            + "<td class='vendor'>" + esc(scanJson.stations[i][3]) + "</td>"
            + "<td class='mac'>" + esc(scanJson.stations[i][0]) + "</td>"
            + "<td class='ch'>" + esc(scanJson.stations[i][1]) + "</td>"
            + "<td class='name'>" + (scanJson.stations[i][2].length > 0 ? esc(scanJson.stations[i][2]) : "<button onclick='add(1," + i + ")'>" + lang("add") + "</button>") + "</td>"
            + "<td class='pkts'>" + esc(scanJson.stations[i][4]) + "</td>"
            + "<td class='ap'>" + ap + "</td>"
            + "<td class='lastseen'>" + esc(scanJson.stations[i][6]) + "</td>"
            + "<td class='selectColumn'><label class='checkBoxContainer'><input type='checkbox' " + (selected ? "checked" : "") + " onclick='selectRow(1," + i + "," + (selected ? "false" : "true") + ")'><span class='checkmark'></span></label></td>"
            + "<td class='remove'><button class='red' onclick='remove(1," + i + ")'>X</button></td>"
            + "</tr>";
    }

    getE("stTable").innerHTML = html;

	




}

function drawNames() {
	var html;
	var selected;

	// Names
	getE("nNum").innerHTML = nameJson.length;
	html = "<tr>"
		+ "<th class='id'></th>"
		+ "<th class='mac'>MAC</th>"
		+ "<th class='vendor'>Vendor</th>"
		+ "<th class='name'>Name</th>"
		+ "<th class='ap'>AP-BSSID</th>"
		+ "<th class='ch'>Ch</th>"
		+ "<th class='save'></th>"
		+ "<th class='selectColumn'></th>"
		+ "<th class='remove'></th>"
		+ "</tr>";

	for (var i = 0; i < nameJson.length; i++) {
		selected = nameJson[i][nameJson[i].length - 1];

		html += (selected ? "<tr class='selected'>" : "<tr>")
			+ "<td class='id'>" + i + "</td>" // ID
			+ "<td class='mac' contentEditable='true' id='name_" + i + "_mac'>" + esc(nameJson[i][0]) + "</td>" // MAC
			+ "<td class='vendor'>" + esc(nameJson[i][1]) + "</td>" // Vendor
			+ "<td class='name' contentEditable='true' id='name_" + i + "_name'>" + esc(nameJson[i][2].substring(0, 16)) + "</td>" // Name
			+ "<td class='ap' contentEditable='true' id='name_" + i + "_apbssid'>" + esc(nameJson[i][3]) + "</td>" // AP-BSSID
			+ "<td class='ch' contentEditable='true' id='name_" + i + "_ch'>" + esc(nameJson[i][4]) + "</td>" // Ch
			+ "<td class='save'><button class='green' onclick='save(" + i + ")'>" + lang("save") + "</button></td>" // Save
			// Select
			+ "<td class='selectColumn'><label class='checkBoxContainer'><input type='checkbox' " + (selected ? "checked" : "") + " onclick='selectRow(2," + i + "," + (selected ? "false" : "true") + ")'><span class='checkmark'></span></label></td>"
			+ "<td class='remove'><button class='red' onclick='remove(2," + i + ")'>X</button></td>" // Remove
			+ "</tr>";
	}

	getE("nTable").innerHTML = html;
}

var duts;
var elxtime;



function scan(type) {
    getE('RButton').disabled = true;
    
    // Stop any existing countdown
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    
    var countdownElement = getE("countdownDisplay");
    var scanTimeSeconds = parseInt(getE("scanTime").value);
    if (isNaN(scanTimeSeconds)) scanTimeSeconds = 15;
    var channel = getE("ch").options[getE("ch").selectedIndex].value;
    
    // Common countdown function
    function startCountdown(seconds) {
        var remaining = seconds;
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
    }
    
    switch (type) {
        case 0: // AP scan
            getE('scanOne').disabled = true;
            getE('scanSniff').disabled = true;
            getE('scanZero').style.visibility = 'hidden';
            elxtime = 2450;
            countdownElement.style.display = "none";
            break;
        case 1: // Station scan
            getE('scanZero').disabled = true;
            getE('scanSniff').disabled = true;
            getE('scanOne').style.visibility = 'hidden';
            startCountdown(scanTimeSeconds);
            elxtime = scanTimeSeconds * 1000 + 1500;
            break;
        case 2: // Sniff (wifi scan)
            getE('scanZero').disabled = true;
            getE('scanOne').disabled = true;
            getE('scanSniff').disabled = true;
            getE('scanSniff').style.visibility = 'hidden';
            startCountdown(scanTimeSeconds);
            // Show deauth heading and reset count
            var deauthHeading = getE("deauthHeading");
            deauthHeading.style.display = "block";
            getE("deauthCount").innerHTML = "0";
            setDeauthColor(0);
            sniffActive = true;
            elxtime = scanTimeSeconds * 1000 + 1500;
            break;
    }
    
    var cmdStr = "";
    if (type == 0) {
        cmdStr = "scan aps -ch " + channel;
    } else if (type == 1) {
        cmdStr = "scan stations -t " + scanTimeSeconds + "s -ch " + channel;
    } else if (type == 2) {
        cmdStr = "scan wifi -t " + scanTimeSeconds + "s -ch " + channel;
    }
    
    getFile("run?cmd=" + cmdStr);
    duts = parseInt(type);
    setTimeout(buttonFunc, elxtime);
    setTimeout(load, elxtime);
}

function buttonFunc() {
    switch (duts) {
        case 0:
            getE('scanZero').style.visibility = 'visible';
            getE('scanOne').disabled = false;
            getE('scanSniff').disabled = false;
            break;
        case 1:
            getE('scanOne').style.visibility = 'visible';
            getE('scanZero').disabled = false;
            getE('scanSniff').disabled = false;
            break;
        case 2:
            getE('scanSniff').style.visibility = 'visible';
            getE('scanSniff').disabled = false;  
            getE('scanZero').disabled = false;
            getE('scanOne').disabled = false;
            break;
    }
    getE('RButton').disabled = false;
}


function load() {
    // APs and Stations
    getFile("run?cmd=save scan", function () {
        getFile("scan.json", function (res) {
            scanJson = JSON.parse(res);
            showMessage("connected");
            updateStationFilter(); 
            drawScan();
            
            // If this was a sniff scan, fetch sniff.json separately
            if (sniffActive) {
                getFile("/sniff.json", function(sniffRes) {
                    if (sniffRes) {
                        try {
                            var sniffData = JSON.parse(sniffRes);
                         	var deauthVal = sniffData.deauths || 0;
							getE("deauthCount").innerHTML = deauthVal;
							setDeauthColor(deauthVal);
                        } catch(e) {
                            console.error("Error parsing sniff.json", e);
                            getE("deauthCount").innerHTML = "?";
                        }
                    } else {
                        getE("deauthCount").innerHTML = "0";
                        setDeauthColor(0);
                    }
                    sniffActive = false;
                });
            }
            
            // Stop countdown if it's still running
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            getE("countdownDisplay").style.display = "none";
        });
    });
    // Names (unchanged)
    getFile("run?cmd=save names", function () {
        getFile("names.json", function (res) {
            nameJson = JSON.parse(res);
            showMessage("connected");
            drawNames();
        });
    });
}


function selectRow(type, id, selected) {
	switch (type) {
		case 0:
			scanJson.aps[id][7] = selected;
			updateStationFilter(); 
			drawScan();
			getFile("run?cmd=" + (selected ? "" : "de") + "select ap " + id);
			break;
		case 1:
			scanJson.stations[id][7] = selected;
			drawScan();
			getFile("run?cmd=" + (selected ? "" : "de") + "select station " + id);
			break;
		case 2:
			save(id);
			nameJson[id][5] = selected;
			drawNames();
			getFile("run?cmd=" + (selected ? "" : "de") + "select name " + id);
	}
}

function remove(type, id) {
	switch (type) {
		case 0:
			scanJson.aps.splice(id, 1);
			updateStationFilter(); 
			drawScan();
			getFile("run?cmd=remove ap " + id);
			break;
		case 1:
			scanJson.stations.splice(id, 1);
			updateStationFilter(); 
			drawScan();
			getFile("run?cmd=remove station " + id);
			break;
		case 2:
			nameJson.splice(id, 1);
			drawNames();
			getFile("run?cmd=remove name " + id);
	}
}

function save(id) {
	var mac = getE("name_" + id + "_mac").innerHTML.replace("<br>", "");
	var name = getE("name_" + id + "_name").innerHTML.replace("<br>", "");
	var apbssid = getE("name_" + id + "_apbssid").innerHTML.replace("<br>", "");
	var ch = getE("name_" + id + "_ch").innerHTML.replace("<br>", "");
	var changed = mac != nameJson[id][0] || name != nameJson[id][2] || apbssid != nameJson[id][3] || ch != nameJson[id][4];
	if (changed) {
		nameJson[id][0] = mac;
		nameJson[id][2] = name;
		nameJson[id][3] = apbssid;
		nameJson[id][4] = ch;

		if (nameJson[id][0].length != 17) {
			showMessage("ERROR: MAC invalid");
			return;
		}

		getFile("run?cmd=replace name " + id + " -n \"" + nameJson[id][2] + "\" -m \"" + nameJson[id][0] + "\" -ch " + nameJson[id][4] + " -b \"" + nameJson[id][3] + "\" " + (nameJson[id][5] ? "-s" : ""));

		drawNames();
	}
}

function add(type, id) {
	if (nameJson.length >= 25) {
		showMessage("Device Name List is full!");
		return;
	}

	switch (type) {
		case 0:
			getFile("run?cmd=add name \"" + scanJson.aps[id][0] + "\" -ap " + id);
			scanJson.aps[id][1] = scanJson.aps[id][0]; // name = SSID
			nameJson.push([scanJson.aps[id][5], scanJson.aps[id][6], scanJson.aps[id][0], "", scanJson.aps[id][2], false]);
			drawScan();
			break;
		case 1:
			getFile("run?cmd=add name \"" + scanJson.stations[id][0] + "\" station " + id);
			scanJson.stations[id][2] = "device_" + nameJson.length; // name = device_
			nameJson.push([scanJson.stations[id][0], scanJson.stations[id][3], "device_" + nameJson.length, scanJson.aps[scanJson.stations[id][5]][5], scanJson.stations[id][1], false]);
			drawScan();
			break;
		case 2:
			getFile("run?cmd=add name device_" + nameJson.length + " -m 00:00:00:00:00:00 -ch 1");
			nameJson.push(["00:00:00:00:00:00", "", "device_" + nameJson.length, "", 1, false]);
			drawNames();
	}

	drawNames();
}

function selectAll(type, select) {
	switch (type) {
		case 0:
			getFile("run?cmd=" + (select ? "" : "de") + "select aps");
			for (var i = 0; i < scanJson.aps.length; i++) scanJson.aps[i][7] = select;
			drawScan();
			break;
		case 1:
			getFile("run?cmd=" + (select ? "" : "de") + "select stations");
			for (var i = 0; i < scanJson.stations.length; i++) scanJson.stations[i][7] = select;
			drawScan();
			break;
		case 2:
			getFile("run?cmd=" + (select ? "" : "de") + "select names");
			for (var i = 0; i < nameJson.length; i++) nameJson[i][5] = select;
			drawNames();
	}
}