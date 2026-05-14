/* This software is licensed under the MIT License: https://github.com/spacehuhntech/esp8266_deauther */

#include "Scan.h"
#include "oui.h"
#include "settings.h"
#include "wifi.h"

extern String searchVendor(uint8_t* mac);



Scan::Scan() {
    list = new SimpleList<uint16_t>;
}

int Scan::findProbeEntry(uint8_t* mac) {
    for (int i = 0; i < probeEntryCount; i++) {
        if (memcmp(probeEntries[i].mac, mac, 6) == 0) return i;
    }
    return -1;
}



void Scan::addOrUpdateProbe(uint8_t* mac, const char* ssid, uint8_t channel, int8_t rssi, const char* vendor) {
    int idx = findProbeEntry(mac);
    if (idx >= 0) {
        probeEntries[idx].count++;
        probeEntries[idx].lastSeen = millis();
        // vendor is not changed – keep original (first seen)
    } else if (probeEntryCount < MAX_PROBE_ENTRIES) {
        idx = probeEntryCount++;
        memcpy(probeEntries[idx].mac, mac, 6);
        strncpy(probeEntries[idx].ssid, ssid, 32);
        probeEntries[idx].ssid[32] = '\0';
        probeEntries[idx].channel = channel;
        probeEntries[idx].rssi = rssi;
        probeEntries[idx].lastSeen = millis();
        probeEntries[idx].count = 1;
        strncpy(probeEntries[idx].vendor, vendor, 32);
        probeEntries[idx].vendor[32] = '\0';
    }
}




void Scan::startProbe(uint32_t time, bool channelHop, uint8_t channel) {
    stop();
    setWifiChannel(channel, true);
    sniffTime = time;
    Scan::channelHop = channelHop;
    scanMode = SCAN_MODE_PROBE;
    scan_continue_mode = SCAN_MODE_OFF;
    snifferStartTime = currentTime;
    probeEntryCount = 0;        // clear previous entries
    probeScanActive = true;
    prnt("Starting probe sniffer - ");
    if (sniffTime > 0) prnt(String(sniffTime / 1000) + "s");
    else prnt("infinitely");
    prnt(" on channel ");
    prntln(channelHop ? "1-14" : String(channel));
    wifi::stopAP();
    wifi_promiscuous_enable(true);
}

void Scan::saveProbeResults() {
    String buf = "[";
    
    // Create or overwrite the file first
    if (!writeFile("/probe.json", buf)) {
        prnt(F("ERROR saving probe.json"));
        probeScanActive = false;
        return;
    }
    
    buf = String(); // Clear buffer to save RAM

    for (int i = 0; i < probeEntryCount; i++) {
        char macStr[18];
        sprintf(macStr, "%02x:%02x:%02x:%02x:%02x:%02x",
                probeEntries[i].mac[0], probeEntries[i].mac[1], probeEntries[i].mac[2],
                probeEntries[i].mac[3], probeEntries[i].mac[4], probeEntries[i].mac[5]);
        
        if (i > 0) buf += ",";
        buf += "{\"mac\":\"" + String(macStr) + "\",";
        buf += "\"ssid\":\"" + String(probeEntries[i].ssid) + "\",";
        buf += "\"channel\":" + String(probeEntries[i].channel) + ",";
        buf += "\"rssi\":" + String(probeEntries[i].rssi) + ",";
        buf += "\"count\":" + String(probeEntries[i].count) + ",";
        buf += "\"vendor\":\"" + String(probeEntries[i].vendor) + "\"}";

        // Dump buffer to SPIFFS to prevent ESP8266 heap crashes
        if (buf.length() >= 512) {
            appendFile("/probe.json", buf);
            buf = String(); 
        }
    }
    
    buf += "]";
    if (buf.length() > 0) {
        appendFile("/probe.json", buf);
    }
    
    prnt(F("Probes saved to /probe.json"));
    probeScanActive = false;
}



void Scan::sniffer(uint8_t* buf, uint16_t len) {
    if (!isSniffing()) return;

    // The first byte of the ESP8266 sniffer buffer is the RSSI (signed 8-bit)
    int8_t rssi = (int8_t)buf[0];
    
    // The 802.11 frame starts after the 12-byte RxControl header
    uint8_t* frame = buf + 12;
    
    packets++;
    
    // Safety check: header (12) + min 802.11 header (24) = 36 bytes minimum
    if (len < 36) return;
    
    uint8_t frameControl = frame[0];
    
    // Handle Deauth/Disassociation
    if (frameControl == 0xC0 || frameControl == 0xA0) {
        tmpDeauths++;
        return;
    }
    
    // Handle Probe Requests
    if (frameControl == 0x40) { 
        if (scanMode == SCAN_MODE_PROBE) {
            uint8_t* srcMac = frame + 10;
            uint8_t* tag = frame + 24;
            uint8_t* end = buf + len;
            char ssid[33] = "";

            while (tag + 1 < end) {
                uint8_t tagNum = tag[0];
                uint8_t tagLen = tag[1];
                if (tag + 2 + tagLen > end) break;
                if (tagNum == 0x00) {
                    if (tagLen > 0 && tagLen < 33) {
                        memcpy(ssid, &tag[2], tagLen);
                        ssid[tagLen] = '\0';
                    }
                    break;
                }
                tag += 2 + tagLen;
            }
            
           
           // Get vendor name from MAC (returns pointer to static string)
            String vendorStr = searchVendor(srcMac);
            char vendor[33] = "";
            if (vendorStr.length() > 0) {
                strncpy(vendor, vendorStr.c_str(), 32);
                vendor[32] = '\0';
            } else {
                vendor[0] = '\0';
            }
            addOrUpdateProbe(srcMac, ssid, wifi_channel, rssi, vendor);
           
        }
        return;
    }
    
    // Process Data Frames (Type 0x08)
    if ((frameControl & 0x0C) == 0x08) {
        uint8_t* macTo   = frame + 4;  // Addr1
        uint8_t* macFrom = frame + 10; // Addr2

        if (macBroadcast(macTo) || macBroadcast(macFrom) || !macValid(macTo) || !macValid(macFrom) || macMulticast(macTo) || macMulticast(macFrom)) return;

        int accesspointNum = findAccesspoint(macFrom);
        if (accesspointNum >= 0) {
            stations.add(macTo, accesspoints.getID(accesspointNum));
        } else {
            accesspointNum = findAccesspoint(macTo);
            if (accesspointNum >= 0) {
                stations.add(macFrom, accesspoints.getID(accesspointNum));
            }
        }
    }
}


int Scan::findAccesspoint(uint8_t* mac) {
    for (int i = 0; i < accesspoints.count(); i++) {
        if (memcmp(accesspoints.getMac(i), mac, 6) == 0) return i;
    }
    return -1;
}

void Scan::start(uint8_t mode) {
    start(mode, sniffTime, scan_continue_mode, continueTime, channelHop, wifi_channel);
}

void Scan::start(uint8_t mode, uint32_t time, uint8_t nextmode, uint32_t continueTime, bool channelHop,
                 uint8_t channel) {
    if (mode != SCAN_MODE_OFF) stop();

    setWifiChannel(channel, true);
    Scan::continueStartTime  = currentTime;
    Scan::snifferPacketTime  = continueStartTime;
    Scan::snifferOutputTime  = continueStartTime;
    Scan::continueTime       = continueTime;
    Scan::sniffTime          = time;
    Scan::channelHop         = channelHop;
    Scan::scanMode           = mode;
    Scan::scan_continue_mode = nextmode;

    if ((sniffTime > 0) && (sniffTime < 1000)) sniffTime = 1000;

    /* AP Scan */
    if ((mode == SCAN_MODE_APS) || (mode == SCAN_MODE_ALL)) {
        accesspoints.removeAll();
        stations.removeAll();
        prntln(SC_START_AP);
        WiFi.scanNetworks(true, true);
    }

    /* Station Scan */
    else if (mode == SCAN_MODE_STATIONS) {
        if (accesspoints.count() < 1) {
            start(SCAN_MODE_ALL);
            return;
        }
        snifferStartTime = currentTime;
        prnt(SC_START_CLIENT);

        if (sniffTime > 0) prnt(String(sniffTime / 1000) + S);
        else prnt(SC_INFINITELY);

        if (!channelHop) {
            prnt(SC_ON_CHANNEL);
            prnt(wifi_channel);
        }
        prntln();

        wifi::stopAP();
        wifi_promiscuous_enable(true);
    }

    else if (mode == SCAN_MODE_SNIFFER) {
        deauths          = tmpDeauths;
        tmpDeauths       = 0;
        snifferStartTime = currentTime;
        prnt(SS_START_SNIFFER);

        if (sniffTime > 0) prnt(String(sniffTime / 1000) + S);
        else prnt(SC_INFINITELY);
        prnt(SC_ON_CHANNEL);
        prntln(channelHop ? str(SC_ONE_TO) + (String)14 : (String)wifi_channel);

        wifi::stopAP();
        wifi_promiscuous_enable(true);
    }

    /* Stop scan */
    else if (mode == SCAN_MODE_OFF) {
        wifi_promiscuous_enable(false);

        if (settings::getWebSettings().enabled) wifi::resumeAP();
        prntln(SC_STOPPED);
        save(true);

        if (scan_continue_mode != SCAN_MODE_OFF) {
            prnt(SC_RESTART);
            prnt(int(continueTime / 1000));
            prntln(SC_CONTINUE);
        }
    }

    /* ERROR */
    else {
        prnt(SC_ERROR_MODE);
        prntln(mode);
        return;
    }
}

void Scan::update() {
    if (scanMode == SCAN_MODE_OFF) {
        if (scan_continue_mode != SCAN_MODE_OFF) {
            if (currentTime - continueStartTime > continueTime) start(scan_continue_mode);
        }
        return;
    }

    // sniffer
    if (isSniffing()) {
        if (currentTime - snifferPacketTime > 1000) {
            snifferPacketTime = currentTime;
            list->add(packets);

            if (list->size() > SCAN_PACKET_LIST_SIZE) list->remove(0);
            deauths    = tmpDeauths;
            tmpDeauths = 0;
            packets    = 0;
        }

        if (currentTime - snifferOutputTime > 3000) {
            char s[100];

            if (sniffTime > 0) {
                sprintf(s, str(SC_OUTPUT_A).c_str(), getPercentage(), packets, stations.count(), deauths);
            } else {
                sprintf(s, str(SC_OUTPUT_B).c_str(), packets, stations.count(), deauths);
            }
            prnt(String(s));
            snifferOutputTime = currentTime;
        }

        if (channelHop && (currentTime - snifferChannelTime > settings::getSnifferSettings().channel_time)) {
            snifferChannelTime = currentTime;

            if (scanMode == SCAN_MODE_STATIONS) nextChannel();  
            else setChannel(wifi_channel + 1);                  
        }
    }

    // APs
    if ((scanMode == SCAN_MODE_APS) || (scanMode == SCAN_MODE_ALL)) {
        int16_t results = WiFi.scanComplete();

        if (results >= 0) {
            for (int16_t i = 0; i < results && i < 256; i++) {
                if (channelHop || (WiFi.channel(i) == wifi_channel)) accesspoints.add(i, false);
            }
            accesspoints.sort();
            accesspoints.printAll();

            if (scanMode == SCAN_MODE_ALL) {
                delay(30);
                start(SCAN_MODE_STATIONS);
            }
            else start(SCAN_MODE_OFF);
        }
    }

    // Stations
    else if ((sniffTime > 0) && (currentTime > snifferStartTime + sniffTime)) {
        wifi_promiscuous_enable(false);
        if (scanMode == SCAN_MODE_STATIONS) {
            stations.sort();
            stations.printAll();
        }
        
        if (scanMode == SCAN_MODE_SNIFFER) {
            saveSniffResults();
        }

        if (scanMode == SCAN_MODE_PROBE) {
            saveProbeResults();
        }

        start(SCAN_MODE_OFF);
    }
}

void Scan::setup() {
    save(true);
}

void Scan::stop() {
    scan_continue_mode = SCAN_MODE_OFF;
    start(SCAN_MODE_OFF);
}

void Scan::setChannel(uint8_t ch) {
    if (ch > 14) ch = 1;
    else if (ch < 1) ch = 14;

    wifi_promiscuous_enable(0);
    setWifiChannel(ch, true);
    wifi_promiscuous_enable(1);
}

void Scan::nextChannel() {
    if (accesspoints.count() > 1) {
        uint8_t ch = wifi_channel;

        do {
            ch++;
            if (ch > 14) ch = 1;
        } while (!apWithChannel(ch));
        setChannel(ch);
    }
}

bool Scan::apWithChannel(uint8_t ch) {
    for (int i = 0; i < accesspoints.count(); i++)
        if (accesspoints.getCh(i) == ch) return true;

    return false;
}

void Scan::save(bool force, String filePath) {
    String tmp = FILE_PATH;
    FILE_PATH = filePath;
    save(true);
    FILE_PATH = tmp;
}

void Scan::save(bool force) {
    if (!(accesspoints.changed || stations.changed) && !force) return;

    // Accesspoints
    String buf = String(OPEN_CURLY_BRACKET) + String(DOUBLEQUOTES) + str(SC_JSON_APS) + String(DOUBLEQUOTES) + String(
        DOUBLEPOINT) + String(OPEN_BRACKET); 

    if (!writeFile(FILE_PATH, buf)) {        
        prnt(F_ERROR_SAVING);
        prntln(FILE_PATH);
        return;
    }

    buf = String(); 
    uint32_t apCount = accesspoints.count();

    for (uint32_t i = 0; i < apCount; i++) {
        buf += String(OPEN_BRACKET) + String(DOUBLEQUOTES) + escape(accesspoints.getSSID(i)) + String(DOUBLEQUOTES) +
               String(COMMA);                                                                                      
        buf += String(DOUBLEQUOTES) + escape(accesspoints.getNameStr(i)) + String(DOUBLEQUOTES) + String(COMMA); 
        buf += String(accesspoints.getCh(i)) + String(COMMA);                                                    
        buf += String(accesspoints.getRSSI(i)) + String(COMMA);                                                  
        buf += String(DOUBLEQUOTES) + accesspoints.getEncStr(i) + String(DOUBLEQUOTES) + String(COMMA);          
        buf += String(DOUBLEQUOTES) + accesspoints.getMacStr(i) + String(DOUBLEQUOTES) + String(COMMA);          
        buf += String(DOUBLEQUOTES) + accesspoints.getVendorStr(i) + String(DOUBLEQUOTES) + String(COMMA);       
        buf += b2s(accesspoints.getSelected(i)) + String(CLOSE_BRACKET);                                         

        if (i < apCount - 1) buf += String(COMMA);                                                               

        if (buf.length() >= 1024) {
            if (!appendFile(FILE_PATH, buf)) {
                prnt(F_ERROR_SAVING);
                prntln(FILE_PATH);
                return;
            }
            buf = String(); 
        }
    }

    // Stations
    buf += String(CLOSE_BRACKET) + String(COMMA) + String(DOUBLEQUOTES) + str(SC_JSON_STATIONS) + String(DOUBLEQUOTES) +
           String(DOUBLEPOINT) + String(OPEN_BRACKET); 
    uint32_t stationCount = stations.count();

    for (uint32_t i = 0; i < stationCount; i++) {
        buf += String(OPEN_BRACKET) + String(DOUBLEQUOTES) + stations.getMacStr(i) + String(DOUBLEQUOTES) +
               String(COMMA);                                                                                    
        buf += String(stations.getCh(i)) + String(COMMA);                                                        
        buf += String(DOUBLEQUOTES) + stations.getNameStr(i) + String(DOUBLEQUOTES) + String(COMMA);             
        buf += String(DOUBLEQUOTES) + stations.getVendorStr(i) + String(DOUBLEQUOTES) + String(COMMA);           
        buf += String(*stations.getPkts(i)) + String(COMMA);                                                     
        buf += String(stations.getAP(i)) + String(COMMA);                                                        
        buf += String(DOUBLEQUOTES) + stations.getTimeStr(i) + String(DOUBLEQUOTES) + String(COMMA);             
        buf += b2s(stations.getSelected(i)) + String(CLOSE_BRACKET);                                             

        if (i < stationCount - 1) buf += String(COMMA);                                                          

        if (buf.length() >= 1024) {
            if (!appendFile(FILE_PATH, buf)) {
                prnt(F_ERROR_SAVING);
                prntln(FILE_PATH);
                return;
            }
            buf = String(); 
        }
    }

    buf += String(CLOSE_BRACKET) + String(CLOSE_CURLY_BRACKET); 

    if (!appendFile(FILE_PATH, buf)) {
        prnt(F_ERROR_SAVING);
        prntln(FILE_PATH);
        return;
    }

    accesspoints.changed = false;
    stations.changed     = false;
    prnt(SC_SAVED_IN);
    prntln(FILE_PATH);
}

//-------------------------------------------------------------------------------------------------------------------------------------
void Scan::saveSniffResults() {
    // Build JSON: { "deauths": X, "packets": Y, "devices": Z }
    String json = String("{") +
                  "\"deauths\":" + String(deauths) + "," +
                  "\"packets\":" + String(packets) + "," +
                  "\"devices\":" + String(stations.count()) +
                  "}";
    
    // Write to /sniff.json (overwrite)
    if (!writeFile("/sniff.json", json)) {
        prnt(F("ERROR saving sniff.json"));
    } else {
        prnt(F("Saved sniff.json"));
    }
}

uint32_t Scan::countSelected() {
    return accesspoints.selected() + stations.selected() + names.selected();
}

uint32_t Scan::countAll() {
    return accesspoints.count() + stations.count() + names.count();
}

bool Scan::isScanning() {
    return scanMode != SCAN_MODE_OFF;
}

bool Scan::isSniffing() {
    return scanMode == SCAN_MODE_STATIONS || scanMode == SCAN_MODE_SNIFFER || scanMode == SCAN_MODE_PROBE;
}

uint8_t Scan::getPercentage() {
    if (!isSniffing()) return 0;
    return (currentTime - snifferStartTime) / (sniffTime / 100);
}

void Scan::selectAll() {
    accesspoints.selectAll();
    stations.selectAll();
    names.selectAll();
}

void Scan::deselectAll() {
    accesspoints.deselectAll();
    stations.deselectAll();
    names.deselectAll();
}

void Scan::printAll() {
    accesspoints.printAll();
    stations.printAll();
    names.printAll();
    ssids.printAll();
}

void Scan::printSelected() {
    accesspoints.printSelected();
    stations.printSelected();
    names.printSelected();
}

uint32_t Scan::getPackets(int i) {
    if (list->size() < SCAN_PACKET_LIST_SIZE) {
        uint8_t translatedNum = SCAN_PACKET_LIST_SIZE - list->size();
        if (i >= translatedNum) return list->get(i - translatedNum);
        return 0;
    } else {
        return list->get(i);
    }
}

String Scan::getMode() {
    switch (scanMode) {
        case SCAN_MODE_OFF:
            return str(SC_MODE_OFF);
        case SCAN_MODE_APS:
            return str(SC_MODE_AP);
        case SCAN_MODE_STATIONS:
            return str(SC_MODE_ST);
        case SCAN_MODE_ALL:
            return str(SC_MODE_ALL);
        case SCAN_MODE_SNIFFER:
            return str(SC_MODE_SNIFFER);
        default:
            return String();
    }
}

double Scan::getScaleFactor(uint8_t height) {
    return (double)height / (double)getMaxPacket();
}

uint32_t Scan::getMaxPacket() {
    uint16_t max = 0;
    for (uint8_t i = 0; i < list->size(); i++) {
        if (list->get(i) > max) max = list->get(i);
    }
    return max;
}

uint32_t Scan::getPacketRate() {
    return list->get(list->size() - 1);
}
