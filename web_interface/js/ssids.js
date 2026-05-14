/* This software is licensed under the MIT License: https://github.com/spacehuhntech/esp8266_deauther */

var ssidJson = { "random": false, "ssids": [] };

function load() {
	getFile("run?cmd=save ssids", function () {
		getFile("ssids.json", function (res) {
			ssidJson = JSON.parse(res);
			showMessage("connected");
			draw();
		});
	});
}

function draw() {
	var html;

	html = "<tr>"
		+ "<th class='id'></th>"
		+ "<th class='ssid'></th>"
		+ "<th class='lock'></th>"
		+ "<th class='save'></th>"
		+ "<th class='remove'></th>"
		+ "</tr>";

	for (var i = 0; i < ssidJson.ssids.length; i++) {
		html += "<tr>"
			+ "<td class='id'>" + i + "</td>" // ID
			+ "<td class='ssid' contenteditable='true' id='ssid_" + i + "'>" + esc(ssidJson.ssids[i][0].substring(0, ssidJson.ssids[i][2])) + "</td>" // SSID
			+ "<td class='lock clickable' onclick='changeEnc(" + i + ")' id='enc_" + i + "'>" + (ssidJson.ssids[i][1] ? "&#x1f512;" : "-") + "</td>" // Enc
			+ "<td class='save'><button class='green' onclick='save(" + i + ")'>" + lang("save") + "</button></td>" // Save
			+ "<td class='remove'><button class='red' onclick='remove(" + i + ")'>X</button></td>" // Remove
			+ "</tr>";
	}

	getE("randomBtn").innerHTML = ssidJson.random ? lang("disable_random") : lang("enable_random");

	getE("ssidTable").innerHTML = html;
}

function remove(id) {
	ssidJson.ssids.splice(id, 1);
	getFile("run?cmd=remove ssid " + id);
	draw();
}

function add() {
	var ssidStr = getE("ssid").value;
	var wpa2 = getE("enc").checked;
	var clones = getE("ssidNum").value;
	var force = getE("overwrite").checked;

	if (ssidStr.length > 0) {
		var cmdStr = "add ssid \"" + ssidStr + "\"" + (force ? " -f" : " ") + " -cl " + clones;
		if (wpa2) cmdStr += " -wpa2";

		getFile("run?cmd=" + cmdStr);

		for (var i = 0; i < clones; i++) {
			if (ssidJson.ssids.length >= 60) ssidJson.ssids.splice(0, 1);
			ssidJson.ssids.push([ssidStr, wpa2]);
		}

		draw();
	}
}

function enableRandom() {
	if (ssidJson.random) {
		getFile("run?cmd=disable random", function () {
			load();
		});
	} else {
		getFile("run?cmd=enable random " + getE("interval").value, function () {
			load();
		});
	}

}

function disableRandom() {

}

function addSelected() {
    var force = getE("overwrite").checked ? " -f" : "";
    var maxListSize = 60;   // SSID_LIST_SIZE from backend
    
    // 1) Clone selected APs – use the backend's built‑in command (no auto‑reload)
    getFile("run?cmd=add ssid -s" + force);
    
    // 2) Clone selected probe SSIDs (from localStorage)
    var probeSelected = localStorage.getItem("probeSelectedSSIDs");
    if (!probeSelected) return;
    
    try {
        var ssids = JSON.parse(probeSelected);
        if (!Array.isArray(ssids) || ssids.length === 0) return;
        
        // Get current SSID count from the frontend's loaded data
        var currentCount = ssidJson.ssids.length;
        var availableSlots = force ? maxListSize : (maxListSize - currentCount);
        if (availableSlots <= 0) {
            showMessage("ERROR: SSID list is full. Use 'overwrite' to make room.");
            return;
        }
        
        // Calculate clones per selected probe SSID (same algorithm as backend)
        var clonesPer = Math.floor(availableSlots / ssids.length);
        if (clonesPer < 1) clonesPer = 1;
        
        // Send one command per probe SSID with the calculated clones count
        for (var i = 0; i < ssids.length; i++) {
            var ssid = ssids[i];
            if (ssid && ssid !== "") {
                var cmd = "add ssid \"" + ssid.replace(/"/g, '\\"') + "\" -cl " + clonesPer + force;
                getFile("run?cmd=" + cmd);
            }
        }
        // No auto‑reload – user must click the Reload button to see changes.
        
    } catch(e) {
        console.error("Error processing probe selections", e);
    }
}

function changeEnc(id) {
	ssidJson.ssids[id][1] = !ssidJson.ssids[id][1];
	draw();
	save(id);
}

function removeAll() {
	ssidJson.ssids = [];
	getFile("run?cmd=remove ssids");
	draw();
}

function save(id) {
	var name = getE("ssid_" + id).innerHTML.replace("<br>", "").substring(0, 32);
	var wpa2 = ssidJson.ssids[id][1];
	ssidJson.ssids[id] = [name, wpa2];

	getFile("run?cmd=replace ssid " + id + " -n \"" + name + "\" " + (wpa2 ? "-wpa2" : ""));
}

