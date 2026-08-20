#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <cstring>
#include <cstdlib>
#include <cstdint>
#include <iomanip>
#include "DeckLinkAPI.h"

// ── DeckLink SDK Compatibility Definitions ──────────────────────────────────
#ifndef BMDDeckLinkDuplex
#define BMDDeckLinkDuplex ((BMDDeckLinkAttributeID)0x64757078) // 'dupx'
#endif

// Duplex Configuration ID FourCC 'dupx' (0x64757078)
static const BMDDeckLinkConfigurationID kDeckLinkConfigDuplexMode = (BMDDeckLinkConfigurationID)0x64757078;

// ── JSON Helper ─────────────────────────────────────────────────────────────
std::string escapeJson(const std::string& str) {
    std::ostringstream ss;
    for (char c : str) {
        if (c == '"') ss << "\\\"";
        else if (c == '\\') ss << "\\\\";
        else if (c == '\b') ss << "\\b";
        else if (c == '\f') ss << "\\f";
        else if (c == '\n') ss << "\\n";
        else if (c == '\r') ss << "\\r";
        else if (c == '\t') ss << "\\t";
        else ss << c;
    }
    return ss.str();
}

std::string getDisplayModeString(BMDDisplayMode mode) {
    switch (mode) {
        case bmdModeNTSC: return "NTSC";
        case bmdModeNTSC2398: return "NTSC 23.98";
        case bmdModePAL: return "PAL";
        case bmdModeHD720p50: return "720p50";
        case bmdModeHD720p5994: return "720p59.94";
        case bmdModeHD720p60: return "720p60";
        case bmdModeHD1080p2398: return "1080p23.98";
        case bmdModeHD1080p24: return "1080p24";
        case bmdModeHD1080p25: return "1080p25";
        case bmdModeHD1080p2997: return "1080p29.97";
        case bmdModeHD1080p30: return "1080p30";
        case bmdModeHD1080i50: return "1080i50";
        case bmdModeHD1080i5994: return "1080i59.94";
        case bmdModeHD1080i6000: return "1080i60";
        case bmdModeHD1080p50: return "1080p50";
        case bmdModeHD1080p5994: return "1080p59.94";
        case bmdModeHD1080p6000: return "1080p60";
        case bmdMode2k2398: return "2K 23.98";
        case bmdMode2k24: return "2K 24";
        case bmdMode2k25: return "2K 25";
        case bmdMode4K2160p2398: return "2160p23.98";
        case bmdMode4K2160p24: return "2160p24";
        case bmdMode4K2160p25: return "2160p25";
        case bmdMode4K2160p2997: return "2160p29.97";
        case bmdMode4K2160p30: return "2160p30";
        case bmdMode4K2160p50: return "2160p50";
        case bmdMode4K2160p5994: return "2160p59.94";
        case bmdMode4K2160p60: return "2160p60";
        default: return "Unknown / Auto";
    }
}

std::string getPixelFormatString(BMDPixelFormat format) {
    switch (format) {
        case bmdFormat8BitYUV: return "8-bit YUV";
        case bmdFormat10BitYUV: return "10-bit YUV";
        case bmdFormat8BitARGB: return "8-bit ARGB";
        case bmdFormat8BitBGRA: return "8-bit BGRA";
        case bmdFormat10BitRGB: return "10-bit RGB";
        case bmdFormat12BitRGB: return "12-bit RGB";
        case bmdFormat12BitRGBLE: return "12-bit RGB LE";
        case bmdFormat10BitRGBXLE: return "10-bit RGBX LE";
        case bmdFormat10BitRGBX: return "10-bit RGBX";
        case bmdFormatH265: return "H.265";
        case bmdFormatDNxHR: return "DNxHR";
        default: return "Unknown";
    }
}

std::string getDuplexString(int64_t duplex) {
    switch (duplex) {
        case bmdDuplexFull: return "full";
        case bmdDuplexHalf: return "half";
        case bmdDuplexInactive: return "inactive";
        default: return "unknown";
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

int cmdList() {
    IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
    if (!iterator) {
        std::cout << "{\"success\":false,\"error\":\"Could not create DeckLink iterator. libDeckLinkAPI.so not found or kernel driver bmd-io not loaded.\",\"devices\":[]}\n";
        return 1;
    }

    std::ostringstream json;
    json << "{\"success\":true,\"devices\":[";

    IDeckLink* deckLink = nullptr;
    int deviceIndex = 0;
    bool first = true;

    while (iterator->Next(&deckLink) == S_OK) {
        if (!first) json << ",";
        first = false;

        const char* deviceNameStr = nullptr;
        deckLink->GetDisplayName(&deviceNameStr);
        std::string displayName = deviceNameStr ? deviceNameStr : "Unknown DeckLink Device";
        if (deviceNameStr) free((void*)deviceNameStr);

        const char* modelNameStr = nullptr;
        deckLink->GetModelName(&modelNameStr);
        std::string modelName = modelNameStr ? modelNameStr : displayName;
        if (modelNameStr) free((void*)modelNameStr);

        int64_t persistentId = 0;
        int64_t topoId = 0;
        int64_t subDeviceIndex = 0;
        int64_t numSubDevices = 1;
        int64_t profileId = 0;
        int64_t duplex = 0;
        bool supportsFullDuplex = false;
        bool supportsInternalKeying = false;
        int64_t videoInputConnections = 0;
        int64_t videoOutputConnections = 0;

        IDeckLinkProfileAttributes* attr = nullptr;
        if (deckLink->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK) {
            attr->GetInt(BMDDeckLinkPersistentID, &persistentId);
            attr->GetInt(BMDDeckLinkTopologicalID, &topoId);
            attr->GetInt(BMDDeckLinkSubDeviceIndex, &subDeviceIndex);
            attr->GetInt(BMDDeckLinkNumberOfSubDevices, &numSubDevices);
            attr->GetInt(BMDDeckLinkProfileID, &profileId);
            attr->GetInt(BMDDeckLinkDuplex, &duplex);
            supportsFullDuplex = (duplex == bmdDuplexFull || duplex == bmdDuplexHalf);
            attr->GetFlag(BMDDeckLinkSupportsInternalKeying, &supportsInternalKeying);
            attr->GetInt(BMDDeckLinkVideoInputConnections, &videoInputConnections);
            attr->GetInt(BMDDeckLinkVideoOutputConnections, &videoOutputConnections);
            attr->Release();
        }

        bool signalLocked = false;
        int64_t detectedMode = 0;
        int64_t detectedPixelFormat = 0;

        IDeckLinkStatus* status = nullptr;
        if (deckLink->QueryInterface(IID_IDeckLinkStatus, (void**)&status) == S_OK) {
            status->GetFlag(bmdDeckLinkStatusVideoInputSignalLocked, &signalLocked);
            status->GetInt(bmdDeckLinkStatusDetectedVideoInputMode, &detectedMode);
            status->GetInt(bmdDeckLinkStatusCurrentVideoInputPixelFormat, &detectedPixelFormat);
            status->Release();
        }

        json << "{"
             << "\"index\":" << deviceIndex << ","
             << "\"display_name\":\"" << escapeJson(displayName) << "\","
             << "\"model_name\":\"" << escapeJson(modelName) << "\","
             << "\"persistent_id\":" << persistentId << ","
             << "\"topological_id\":" << topoId << ","
             << "\"sub_device_index\":" << subDeviceIndex << ","
             << "\"num_sub_devices\":" << numSubDevices << ","
             << "\"profile_id\":" << profileId << ","
             << "\"duplex_mode\":\"" << getDuplexString(duplex) << "\","
             << "\"supports_full_duplex\":" << (supportsFullDuplex ? "true" : "false") << ","
             << "\"supports_internal_keying\":" << (supportsInternalKeying ? "true" : "false") << ","
             << "\"video_input_connections\":" << videoInputConnections << ","
             << "\"video_output_connections\":" << videoOutputConnections << ","
             << "\"signal_locked\":" << (signalLocked ? "true" : "false") << ","
             << "\"detected_mode\":\"" << escapeJson(getDisplayModeString((BMDDisplayMode)detectedMode)) << "\","
             << "\"detected_pixel_format\":\"" << escapeJson(getPixelFormatString((BMDPixelFormat)detectedPixelFormat)) << "\""
             << "}";

        deckLink->Release();
        deviceIndex++;
    }

    json << "]}";
    iterator->Release();

    std::cout << json.str() << "\n";
    return 0;
}

int cmdStatus(int targetDeviceIndex, int64_t targetPersistentId) {
    IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
    if (!iterator) {
        std::cout << "{\"success\":false,\"error\":\"DeckLink driver not loaded.\"}\n";
        return 1;
    }

    IDeckLink* deckLink = nullptr;
    int currentIndex = 0;
    bool found = false;

    while (iterator->Next(&deckLink) == S_OK) {
        int64_t pId = 0;
        IDeckLinkProfileAttributes* attr = nullptr;
        if (deckLink->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK) {
            attr->GetInt(BMDDeckLinkPersistentID, &pId);
            attr->Release();
        }

        if ((targetPersistentId != 0 && pId == targetPersistentId) ||
            (targetPersistentId == 0 && currentIndex == targetDeviceIndex)) {
            found = true;
            break;
        }

        deckLink->Release();
        currentIndex++;
    }
    iterator->Release();

    if (!found || !deckLink) {
        std::cout << "{\"success\":false,\"error\":\"Device not found.\"}\n";
        return 1;
    }

    const char* deviceNameStr = nullptr;
    deckLink->GetDisplayName(&deviceNameStr);
    std::string displayName = deviceNameStr ? deviceNameStr : "Unknown Device";
    if (deviceNameStr) free((void*)deviceNameStr);

    bool signalLocked = false;
    int64_t detectedMode = 0;
    int64_t detectedPixelFormat = 0;

    IDeckLinkStatus* status = nullptr;
    if (deckLink->QueryInterface(IID_IDeckLinkStatus, (void**)&status) == S_OK) {
        status->GetFlag(bmdDeckLinkStatusVideoInputSignalLocked, &signalLocked);
        status->GetInt(bmdDeckLinkStatusDetectedVideoInputMode, &detectedMode);
        status->GetInt(bmdDeckLinkStatusCurrentVideoInputPixelFormat, &detectedPixelFormat);
        status->Release();
    }

    std::cout << "{"
              << "\"success\":true,"
              << "\"device_index\":" << currentIndex << ","
              << "\"display_name\":\"" << escapeJson(displayName) << "\","
              << "\"signal_locked\":" << (signalLocked ? "true" : "false") << ","
              << "\"detected_mode\":\"" << escapeJson(getDisplayModeString((BMDDisplayMode)detectedMode)) << "\","
              << "\"detected_pixel_format\":\"" << escapeJson(getPixelFormatString((BMDPixelFormat)detectedPixelFormat)) << "\""
              << "}\n";

    deckLink->Release();
    return 0;
}

int cmdConfigure(int targetDeviceIndex, int64_t targetPersistentId, const std::string& duplexMode, int64_t defaultVideoMode, int64_t videoConnection) {
    IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
    if (!iterator) {
        std::cout << "{\"success\":false,\"error\":\"DeckLink driver not loaded.\"}\n";
        return 1;
    }

    IDeckLink* deckLink = nullptr;
    int currentIndex = 0;
    bool found = false;

    while (iterator->Next(&deckLink) == S_OK) {
        int64_t pId = 0;
        IDeckLinkProfileAttributes* attr = nullptr;
        if (deckLink->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr) == S_OK) {
            attr->GetInt(BMDDeckLinkPersistentID, &pId);
            attr->Release();
        }

        if ((targetPersistentId != 0 && pId == targetPersistentId) ||
            (targetPersistentId == 0 && currentIndex == targetDeviceIndex)) {
            found = true;
            break;
        }

        deckLink->Release();
        currentIndex++;
    }
    iterator->Release();

    if (!found || !deckLink) {
        std::cout << "{\"success\":false,\"error\":\"Device not found.\"}\n";
        return 1;
    }

    IDeckLinkConfiguration* config = nullptr;
    if (deckLink->QueryInterface(IID_IDeckLinkConfiguration, (void**)&config) != S_OK) {
        deckLink->Release();
        std::cout << "{\"success\":false,\"error\":\"Could not obtain IDeckLinkConfiguration interface.\"}\n";
        return 1;
    }

    bool configChanged = false;

    if (!duplexMode.empty()) {
        int64_t mode = (int64_t)bmdDuplexHalf;
        if (duplexMode == "full") mode = (int64_t)bmdDuplexFull;
        else if (duplexMode == "inactive") mode = (int64_t)bmdDuplexInactive;
        
        HRESULT res = config->SetInt(kDeckLinkConfigDuplexMode, mode);
        if (res == S_OK) configChanged = true;
    }

    if (defaultVideoMode > 0) {
        HRESULT res = config->SetInt(bmdDeckLinkConfigDefaultVideoOutputMode, defaultVideoMode);
        if (res == S_OK) configChanged = true;
    }

    if (videoConnection > 0) {
        HRESULT res = config->SetInt(bmdDeckLinkConfigVideoOutputConnection, videoConnection);
        if (res == S_OK) configChanged = true;
    }

    config->Release();
    deckLink->Release();

    std::cout << "{\"success\":true,\"message\":\"Configuration applied successfully.\",\"changed\":" << (configChanged ? "true" : "false") << "}\n";
    return 0;
}

int main(int argc, char** argv) {
    if (argc < 2 || std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h") {
        std::cout << "Usage: decklink-ctl <command> [options]\n\n"
                  << "Commands:\n"
                  << "  list                          List all connected DeckLink devices in JSON format\n"
                  << "  status --device=<idx|pId>     Get real-time signal and telemetry status for a device\n"
                  << "  configure --device=<idx> ...  Apply configuration to a DeckLink sub-device\n"
                  << "  --version, -v, version        Print utility version and DeckLink SDK report\n";
        return 0;
    }

    std::string cmd = argv[1];

    if (cmd == "--version" || cmd == "-v" || cmd == "version") {
        #ifdef DECKLINK_SDK_VERSION
        std::string sdkVer = DECKLINK_SDK_VERSION;
        #elif defined(BLACKMAGIC_DECKLINK_API_VERSION)
        std::stringstream sdkVerSs;
        uint32_t rawHex = BLACKMAGIC_DECKLINK_API_VERSION;
        uint32_t major = (rawHex >> 24) & 0xFF;
        uint32_t minor = (rawHex >> 16) & 0xFF;
        uint32_t patch = (rawHex >> 8) & 0xFF;
        sdkVerSs << major << "." << minor;
        if (patch) sdkVerSs << "." << patch;
        std::string sdkVer = sdkVerSs.str();
        #else
        std::string sdkVer = "Native SDK";
        #endif

        std::cout << "decklink-ctl v1.0.0 (Blackmagic DeckLink Orchestrator for ffmpeg-gui)\n"
                  << "DeckLink API Version: " << sdkVer << "\n"
                  << "Build Date: " << __DATE__ << " " << __TIME__ << "\n"
                  << "Architecture: Linux x86_64 / C++11\n"
                  << "Features: Device Discovery, Duplex Configuration, Real-time Signal Lock & Telemetry\n";
        return 0;
    }

    if (cmd == "list") {
        return cmdList();
    }

    if (cmd == "status") {
        int deviceIndex = 0;
        int64_t persistentId = 0;
        for (int i = 2; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg.rfind("--device=", 0) == 0) {
                std::string val = arg.substr(9);
                if (val.length() > 6) persistentId = std::stoll(val);
                else deviceIndex = std::stoi(val);
            }
        }
        return cmdStatus(deviceIndex, persistentId);
    }

    if (cmd == "configure") {
        int deviceIndex = 0;
        int64_t persistentId = 0;
        std::string duplex;
        int64_t defaultMode = 0;
        int64_t connection = 0;

        for (int i = 2; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg.rfind("--device=", 0) == 0) {
                std::string val = arg.substr(9);
                if (val.length() > 6) persistentId = std::stoll(val);
                else deviceIndex = std::stoi(val);
            } else if (arg.rfind("--duplex=", 0) == 0) {
                duplex = arg.substr(9);
            } else if (arg.rfind("--default-mode=", 0) == 0) {
                defaultMode = std::stoll(arg.substr(15));
            } else if (arg.rfind("--connection=", 0) == 0) {
                connection = std::stoll(arg.substr(13));
            }
        }
        return cmdConfigure(deviceIndex, persistentId, duplex, defaultMode, connection);
    }

    std::cout << "{\"success\":false,\"error\":\"Unknown command: " << escapeJson(cmd) << "\"}\n";
    return 1;
}
