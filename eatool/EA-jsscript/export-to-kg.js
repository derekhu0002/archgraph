!INC Local Scripts.EAConstants-JScript
!INC JSON-Parser

/*
 * Script Name: Export Diagram to JSON File
 * Author: Your Name
 * Purpose: Exports node and relation types of the current diagram to a user-selected JSON file.
 *          Compatible with older JScript engines without a native JSON object.
 * Date: 2025-07-12 	
 */

if (typeof PROJECT_CONFIG_FILE_PATH == "undefined") {
	var PROJECT_CONFIG_FILE_PATH = ""; // Optional absolute path. If empty, use <projectPath>\\.aicodingconfig
}

if (typeof EA_AUTOGEN_CONFIG == "undefined" || EA_AUTOGEN_CONFIG == null) {
	var EA_AUTOGEN_CONFIG = {
		projectPath: "",
		needCode: false,
		needContent: false,
		needdoc: false,
		needallmaintenace: "All",
		needbrowserlocation: false,
		maintenacetype: "forproject" // forllm | forproject
	};
}

function trimString(s) {
	if (s == null) {
		return "";
	}
	return ("" + s).replace(/^\s+|\s+$/g, "");
}

function getConnectionProperty(connectionString, keyName) {
	if (connectionString == null || connectionString == "") {
		return "";
	}
	var pattern = new RegExp("(?:^|;)\\s*" + keyName + "\\s*=\\s*([^;]+)", "i");
	var m = ("" + connectionString).match(pattern);
	if (m && m.length > 1) {
		return trimString(m[1]);
	}
	return "";
}

function stripWrappedQuotes(s) {
	var v = trimString(s);
	if (v.length >= 2) {
		var first = v.charAt(0);
		var last = v.charAt(v.length - 1);
		if ((first == '"' && last == '"') || (first == "'" && last == "'")) {
			return v.substring(1, v.length - 1);
		}
	}
	return v;
}

function getTaggedValueText(tagCollection, tagName) {
	if (tagCollection == null || tagName == null || tagName == "") {
		return "";
	}
	try {
		var tag = tagCollection.GetByName(tagName);
		if (tag == null) {
			return "";
		}
		if (tag.Value == "<memo>" && tag.Notes != "") {
			return "" + tag.Notes;
		}
		if (tag.Value != "") {
			return "" + tag.Value;
		}
		return "" + tag.Notes;
	} catch (e) {
		return "";
	}
}

function getElementTag(ele, tagName) {
	if (ele == null) {
		return "";
	}
	return getTaggedValueText(ele.TaggedValues, tagName);
}

function getConnectorTag(conn, tagName) {
	if (conn == null) {
		return "";
	}
	return getTaggedValueText(conn.TaggedValues, tagName);
}

function getDiagramTag(diagram, tagName) {
	if (diagram == null) {
		return "";
	}
	return getStyleToken(diagram.StyleEx, tagName);
}

function getStyleToken(styleText, key) {
	if (styleText == null || key == null || key == "") {
		return "";
	}
	var pattern = new RegExp("(?:^|;)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)", "i");
	var match = ("" + styleText).match(pattern);
	if (match && match.length > 1) {
		return match[1];
	}
	return "";
}

function getStyleJsonArray(styleText, key) {
	var value = getStyleToken(styleText, key);
	if (value == "") {
		return null;
	}
	try {
		var decoded = decodeURIComponent(value);
		var parsed = JSON.parse(decoded);
		if (parsed instanceof Array) {
			return parsed;
		}
	} catch (e) {
		Session.Output("WARN: Could not parse diagram style JSON token " + key + ": " + e.message);
	}
	return null;
}

function schemaIdArrayToJsonStrings(ids) {
	var result = [];
	if (!(ids instanceof Array)) {
		return result;
	}
	for (var i = 0; i < ids.length; i++) {
		result.push('"' + jsonEscape(ids[i]) + '"');
	}
	return result;
}

function resolveModelFilePathFromConnectionString() {
	var conn = "";
	try {
		conn = "" + Repository.ConnectionString;
	} catch (e) {
		return "";
	}

	if (conn == "") {
		return "";
	}

	var dataSource = getConnectionProperty(conn, "Data Source");
	if (dataSource == "") {
		dataSource = getConnectionProperty(conn, "DataSource");
	}
	if (dataSource == "") {
		dataSource = getConnectionProperty(conn, "DBQ");
	}
	if (dataSource != "") {
		return stripWrappedQuotes(dataSource);
	}

	var direct = stripWrappedQuotes(conn);
	if (/^[A-Za-z]:\\/.test(direct) || /^\\\\/.test(direct)) {
		return direct;
	}

	return "";
}

function normalizeProjectPath(pathValue) {
	if (pathValue == null || pathValue == "") {
		return "";
	}
	var s = "" + pathValue;
	if (s.charAt(s.length - 1) != "\\" && s.charAt(s.length - 1) != "/") {
		s += "\\";
	}
	return s;
}

function isAbsolutePath(pathValue) {
	if (pathValue == null || pathValue == "") {
		return false;
	}
	var s = trimString(pathValue);
	return /^[A-Za-z]:[\\/]/.test(s) || /^\\\\/.test(s) || /^\//.test(s);
}

function resolveContentPath(pathValue) {
	if (pathValue == null || pathValue == "") {
		return "";
	}
	if (isAbsolutePath(pathValue)) {
		return "" + pathValue;
	}
	return projectPath + pathValue;
}

function resolveProjectPathFromCurrentModel() {
	var modelFilePath = resolveModelFilePathFromConnectionString();
	if (modelFilePath == "") {
		return "";
	}
	try {
		var fso = new ActiveXObject("Scripting.FileSystemObject");
		var parentFolder = fso.GetParentFolderName(modelFilePath);
		return normalizeProjectPath(parentFolder);
	} catch (e) {
		return "";
	}
}

function getProjectConfigPath() {
	if (PROJECT_CONFIG_FILE_PATH != null && PROJECT_CONFIG_FILE_PATH != "") {
		return PROJECT_CONFIG_FILE_PATH;
	}
	var base = normalizeProjectPath(EA_AUTOGEN_CONFIG.projectPath);
	if (base == "") {
		return "";
	}
	return base + ".aicodingconfig";
}

function readTextFileUtf8(filePath) {
	try {
		var fso = new ActiveXObject("Scripting.FileSystemObject");
		if (!fso.FileExists(filePath)) {
			Session.Output("WARN: File not found: " + filePath);
			return "";
		}

		var stream = new ActiveXObject("ADODB.Stream");
		stream.Type = 2;
		stream.Charset = "utf-8";
		stream.Open();
		stream.LoadFromFile(filePath);
		var text = stream.ReadText();
		stream.Close();
		return text;
	} catch (e) {
		Session.Output("ERROR: Failed reading config file. " + e.message);
		return "";
	}
}

function parseAiCodingConfig(text) {
	if (text == null) {
		return null;
	}

	var raw = "" + text;
	raw = raw.replace(/^\uFEFF/, "");
	raw = raw.replace(/\/\*[\s\S]*?\*\//g, "");
	raw = raw.replace(/^\s*\/\/.*$/gm, "");
	raw = raw.replace(/^\s+|\s+$/g, "");

	if (raw == "") {
		return null;
	}

	var objectLiteral = raw;
	var assignedMatch = raw.match(/EA_AUTOGEN_CONFIG\s*=\s*([\s\S]*?)\s*;?\s*$/);
	if (assignedMatch && assignedMatch.length > 1) {
		objectLiteral = assignedMatch[1];
	}

	try {
		var parsed = eval("(" + objectLiteral + ")");
		if (parsed == null) {
			return null;
		}
		if (typeof parsed.EA_AUTOGEN_CONFIG != "undefined") {
			return parsed.EA_AUTOGEN_CONFIG;
		}
		if (typeof parsed.eaAutogenConfig != "undefined") {
			return parsed.eaAutogenConfig;
		}
		return parsed;
	} catch (e) {
		Session.Output("WARN: .aicodingconfig parse failed. " + e.message);
		return null;
	}
}

function applyExternalConfig(overrides) {
	if (overrides == null) {
		return;
	}

	if (typeof overrides.projectPath != "undefined") EA_AUTOGEN_CONFIG.projectPath = overrides.projectPath;
	if (typeof overrides.needCode != "undefined") EA_AUTOGEN_CONFIG.needCode = overrides.needCode;
	if (typeof overrides.needContent != "undefined") EA_AUTOGEN_CONFIG.needContent = overrides.needContent;
	if (typeof overrides.needdoc != "undefined") EA_AUTOGEN_CONFIG.needdoc = overrides.needdoc;
	if (typeof overrides.needallmaintenace != "undefined") {
		if (overrides.needallmaintenace === true) {
			EA_AUTOGEN_CONFIG.needallmaintenace = "All";
		} else if (overrides.needallmaintenace === false) {
			EA_AUTOGEN_CONFIG.needallmaintenace = "onlyActive";
		} else {
			EA_AUTOGEN_CONFIG.needallmaintenace = overrides.needallmaintenace;
		}
	}
	if (typeof overrides.needbrowserlocation != "undefined") EA_AUTOGEN_CONFIG.needbrowserlocation = overrides.needbrowserlocation;
	if (typeof overrides.maintenacetype != "undefined") EA_AUTOGEN_CONFIG.maintenacetype = overrides.maintenacetype;

	EA_AUTOGEN_CONFIG.projectPath = normalizeProjectPath(EA_AUTOGEN_CONFIG.projectPath);
}

function initializeAutogenConfig() {
	Repository.EnsureOutputVisible("Script");

	if (EA_AUTOGEN_CONFIG == null) {
		EA_AUTOGEN_CONFIG = {};
	}

	EA_AUTOGEN_CONFIG.projectPath = normalizeProjectPath(EA_AUTOGEN_CONFIG.projectPath);

	var autoProjectPath = resolveProjectPathFromCurrentModel();
	if (EA_AUTOGEN_CONFIG.projectPath == "" && autoProjectPath != "") {
		EA_AUTOGEN_CONFIG.projectPath = autoProjectPath;
		Session.Output("Auto projectPath from EA model: " + EA_AUTOGEN_CONFIG.projectPath);
	}

	var configFilePath = getProjectConfigPath();
	if (configFilePath != "") {
		Session.Output("Config path: " + configFilePath);
		var configText = readTextFileUtf8(configFilePath);
		if (configText != "") {
			var fileConfig = parseAiCodingConfig(configText);
			if (fileConfig != null) {
				applyExternalConfig(fileConfig);
				Session.Output("Loaded config from .aicodingconfig");
			}
		}
	}
}

// Helper function to escape strings for JSON
function jsonEscape(str) {
    if (str == null || typeof str === "undefined") return "";
    // Ensure it's a string before calling replace
    var s = String(str);
    // Escape backslashes, double quotes, and control characters for valid JSON
    return s.replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t');
}

function safeSchemaString(value, fallbackValue) {
	var text = trimString(value);
	if (text != "") {
		return text;
	}
	return trimString(fallbackValue);
}

function normalizeArchimateName(value) {
	var text = trimString(value);
	text = text.replace(/^ArchiMate[_\s-]*/i, "");
	text = text.replace(/&/g, "");
	text = text.replace(/[^A-Za-z0-9]/g, "");
	return text;
}

function displayArchimateName(normalized) {
	switch (trimString(normalized)) {
		case "Class": return "Grouping";
		case "ValueStream": return "Value Stream";
		case "CourseOfAction": return "Course of Action";
		case "BusinessActor": return "Business Actor";
		case "BusinessRole": return "Business Role";
		case "BusinessCollaboration": return "Business Collaboration";
		case "BusinessInterface": return "Business Interface";
		case "BusinessProcess": return "Business Process";
		case "BusinessFunction": return "Business Function";
		case "BusinessInteraction": return "Business Interaction";
		case "BusinessEvent": return "Business Event";
		case "BusinessService": return "Business Service";
		case "BusinessObject": return "Business Object";
		case "ApplicationComponent": return "Application Component";
		case "ApplicationCollaboration": return "Application Collaboration";
		case "ApplicationInterface": return "Application Interface";
		case "ApplicationProcess": return "Application Process";
		case "ApplicationFunction": return "Application Function";
		case "ApplicationInteraction": return "Application Interaction";
		case "ApplicationEvent": return "Application Event";
		case "ApplicationService": return "Application Service";
		case "DataObject": return "Data Object";
		case "SystemSoftware": return "System Software";
		case "TechnologyCollaboration": return "Technology Collaboration";
		case "TechnologyInterface": return "Technology Interface";
		case "CommunicationNetwork": return "Communication Network";
		case "TechnologyProcess": return "Technology Process";
		case "TechnologyFunction": return "Technology Function";
		case "TechnologyInteraction": return "Technology Interaction";
		case "TechnologyEvent": return "Technology Event";
		case "TechnologyService": return "Technology Service";
		case "DistributionNetwork": return "Distribution Network";
		case "WorkPackage": return "Work Package";
		case "ImplementationEvent": return "Implementation Event";
		case "AndJunction": return "And Junction";
		case "OrJunction": return "Or Junction";
		case "Resource":
		case "Capability":
		case "Contract":
		case "Representation":
		case "Product":
		case "Node":
		case "Device":
		case "Path":
		case "Artifact":
		case "Equipment":
		case "Facility":
		case "Material":
		case "Stakeholder":
		case "Driver":
		case "Assessment":
		case "Goal":
		case "Outcome":
		case "Principle":
		case "Requirement":
		case "Constraint":
		case "Meaning":
		case "Value":
		case "Deliverable":
		case "Plateau":
		case "Gap":
		case "Grouping":
		case 'Skill':
		case 'Rule':
		case "Location":
		case "Association":
		case "Composition":
		case "Aggregation":
		case "Assignment":
		case "Realization":
		case "Serving":
		case "Access":
		case "Influence":
		case "Triggering":
		case "Flow":
		case "Specialization":
			return normalized;
		default:
			return "";
	}
}

function canonicalArchimateType(value) {
	var normalized = normalizeArchimateName(value);
	return displayArchimateName(normalized);
}

function canonicalElementType(value, fallbackValue) {
	var display = canonicalArchimateType(value);
	if (isSchemaElementType(display)) {
		return display;
	}
	display = canonicalArchimateType(fallbackValue);
	if (isSchemaElementType(display)) {
		return display;
	}
	Session.Output("WARN: Unknown element type '" + value + "', exporting as Grouping for schema compliance.");
	return "Grouping";
}

function canonicalRelationshipType(value, fallbackValue) {
	var display = canonicalArchimateType(value);
	if (isSchemaRelationshipType(display)) {
		return display;
	}
	display = canonicalArchimateType(fallbackValue);
	if (isSchemaRelationshipType(display)) {
		return display;
	}
	Session.Output("WARN: Unknown relationship type '" + value + "', exporting as Association for schema compliance.");
	return "Association";
}

function isSchemaElementType(value) {
	switch (trimString(value)) {
		case "Resource":
		case "Capability":
		case "Value Stream":
		case "Course of Action":
		case "Business Actor":
		case "Business Role":
		case "Business Collaboration":
		case "Business Interface":
		case "Business Process":
		case "Business Function":
		case "Business Interaction":
		case "Business Event":
		case "Business Service":
		case "Business Object":
		case "Contract":
		case "Representation":
		case "Product":
		case "Application Component":
		case "Application Collaboration":
		case "Application Interface":
		case "Application Process":
		case "Application Function":
		case "Application Interaction":
		case "Application Event":
		case "Application Service":
		case "Data Object":
		case "Node":
		case "Device":
		case "System Software":
		case "Technology Collaboration":
		case "Technology Interface":
		case "Path":
		case "Communication Network":
		case "Technology Process":
		case "Technology Function":
		case "Technology Interaction":
		case "Technology Event":
		case "Technology Service":
		case "Artifact":
		case "Equipment":
		case "Facility":
		case "Distribution Network":
		case "Material":
		case "Stakeholder":
		case "Driver":
		case "Assessment":
		case "Goal":
		case "Outcome":
		case "Principle":
		case "Requirement":
		case "Constraint":
		case "Meaning":
		case "Value":
		case "Work Package":
		case "Deliverable":
		case "Implementation Event":
		case "Plateau":
		case "Gap":
		case "Grouping":
		case 'Skill':
		case 'Rule':
		case "Location":
		case "And Junction":
		case "Or Junction":
			return true;
		default:
			return false;
	}
}

function isSchemaRelationshipType(value) {
	switch (trimString(value)) {
		case "Association":
		case "Composition":
		case "Aggregation":
		case "Assignment":
		case "Realization":
		case "Serving":
		case "Access":
		case "Influence":
		case "Triggering":
		case "Flow":
		case "Specialization":
			return true;
		default:
			return false;
	}
}

function getCode(mainbehavior_fullpath) {
	var sanitizedpath = mainbehavior_fullpath.replace(/\\/g, "\\\\");
    var fileContent = "Relative File Path:" + sanitizedpath + "\n\n"; // Default return value
	
    try {
        // Use ADODB.Stream for robust character set handling
        var stream = new ActiveXObject("ADODB.Stream");

        // 1. Specify the character set of the source file BEFORE opening it.
        //    This is the most important step.
        stream.Charset = "UTF-8";

        // 2. Open the stream object
        stream.Open();

        // 3. Load the entire file from the specified path
        //    Note: We need to ensure the file exists first to avoid an error.
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        if (fso.FileExists(sanitizedpath)) {
            stream.LoadFromFile(sanitizedpath);

            // 4. Read the entire stream as text. Because the Charset was set to UTF-8,
            //    it will be decoded correctly.
            fileContent += stream.ReadText();
        } else {
            Session.Output("Error: File not found at path: " + sanitizedpath);
        }

        // 5. Close the stream to release resources
        stream.Close();

    } catch (e) {
        // Catch any other potential errors (e.g., permission denied)
        Session.Output("An unexpected error occurred in getcode(): " + e.message);
        Session.Output("File Path: " + mainbehavior_fullpath);
        fileContent = ""; // Ensure we return empty on error
    }

    // 6. Return the correctly decoded file content
    return fileContent;
}

function getDate(date) {
	var dd = new Date(date);
	var timestamp = dd.getFullYear() + "-" + (dd.getMonth() + 1) + "-" + dd.getDate();
	return timestamp;
}

function getPackagePath(packageID) {
    var path = "";
    var currentPkgID = packageID;
    var maxDepth = 20; // Prevent infinite loops
    var depth = 0;
    
    while (currentPkgID != 0 && depth < maxDepth) {
        var pkg as EA.Package;
        pkg = Repository.GetPackageByID(currentPkgID);
        if (pkg != null) {
            if (path == "") {
                path = pkg.Name;
            } else {
                path = pkg.Name + "/" + path;
            }
            currentPkgID = pkg.ParentID;
        } else {
            break;
        }
        depth++;
    }
    return path;
}

function getElementChainPath(elementID) {
	var path = "";
	var currentElementID = elementID;
	var maxDepth = 50; // Prevent infinite loops
	var depth = 0;

	while (currentElementID != 0 && depth < maxDepth) {
		var currentElement as EA.Element;
		currentElement = Repository.GetElementByID(currentElementID);
		if (currentElement == null) {
			break;
		}

		if (path == "") {
			path = currentElement.Name;
		} else {
			path = currentElement.Name + "/" + path;
		}

		currentElementID = currentElement.ParentID;
		depth++;
	}

	return path;
}

function getElementBrowserPath(ele) {
	var pkgPath = getPackagePath(ele.PackageID);
	var parentElementPath = "";

	if (ele.ParentID != 0) {
		parentElementPath = getElementChainPath(ele.ParentID);
	}

	var fullPath = pkgPath;
	if (parentElementPath != "") {
		if (fullPath == "") {
			fullPath = parentElementPath;
		} else {
			fullPath += "/" + parentElementPath;
		}
	}

	if (ele.Name != "") {
		if (fullPath == "") {
			fullPath = ele.Name;
		} else {
			fullPath += "/" + ele.Name;
		}
	}

	return fullPath;
}

function getDiagramBrowserPath(diagram) {
	var pkgPath = getPackagePath(diagram.PackageID);
	var fullPath = pkgPath;

	if (diagram.ParentID != 0) {
		var parentElementPath = getElementChainPath(diagram.ParentID);
		if (parentElementPath != "") {
			if (fullPath == "") {
				fullPath = parentElementPath;
			} else {
				fullPath += "/" + parentElementPath;
			}
		}
	}

	if (diagram.Name != "") {
		if (fullPath == "") {
			fullPath = diagram.Name;
		} else {
			fullPath += "/" + diagram.Name;
		}
	}

	return fullPath;
}

function getElementIdentifier(ele) {
	if (ele == null) {
		return "";
	}
	var schemaId = getElementTag(ele, "schema_id");
	if (schemaId != "") {
		return schemaId;
	}
	if (typeof ele.ElementID != "undefined" && ele.ElementID != null && ele.ElementID != "") {
		return "" + ele.ElementID;
	}
	return "" + ele.ElementID;
}

function getTestClassName(testClassValue) {
	var normalized = trimString(testClassValue);
	switch (normalized) {
		case "1":
			return "Unit Test";
		case "2":
			return "Integration Test";
		case "3":
			return "System Test";
		case "4":
			return "Acceptance Test";
		case "5":
			return "Scenario Test";
		case "6":
			return "Inspection Test";
		default:
			return normalized;
	}
}

function getConnectorIdentifier(conn) {
	if (conn == null) {
		return "";
	}
	var schemaId = getConnectorTag(conn, "schema_id");
	if (schemaId != "") {
		return schemaId;
	}
	if (typeof conn.ConnectorID != "undefined" && conn.ConnectorID != null && conn.ConnectorID != "") {
		return "" + conn.ConnectorID;
	}
	return "" + conn.ConnectorID;
}

function getDiagramIdentifier(diagram) {
	if (diagram == null) {
		return "";
	}
	var schemaId = getStyleToken(diagram.StyleEx, "schema_view_id");
	if (schemaId != "") {
		return schemaId;
	}
	// Fallback: look up schema_sub_view_map TaggedValue on parent element by diagram name.
	// This covers cases where EA silently drops StyleEx tokens.
	if (diagram.ParentID != 0) {
		var parentEle = Repository.GetElementByID(diagram.ParentID);
		if (parentEle != null) {
			var subViewMapJson = getElementTag(parentEle, "schema_sub_view_map");
			if (subViewMapJson != "") {
				try {
					var subViewMap = JSON.parse(subViewMapJson);
					if (subViewMap[diagram.Name] != null) {
						return "" + subViewMap[diagram.Name];
					}
				} catch (e) {
					// Ignore parse error; fall through to DiagramID.
				}
			}
		}
	}
	if (typeof diagram.DiagramID != "undefined" && diagram.DiagramID != null && diagram.DiagramID != "") {
		return "" + diagram.DiagramID;
	}
	return "" + diagram.DiagramID;
}

// 无头覆盖（headless/run-headless.ps1 注入 EA_HEADLESS_DIAGRAM_ID）：自动化下直接按图 ID
// 取当前导出根图；未注入时返回 null，由 main() 走 Repository.GetCurrentDiagram()。
function resolveHeadlessDiagram() {
	try {
		var overrideId = 0;
		if (typeof EA_HEADLESS_DIAGRAM_ID != "undefined") {
			overrideId = parseInt(EA_HEADLESS_DIAGRAM_ID, 10) || 0;
		}
		if (overrideId != 0) {
			var diagram = Repository.GetDiagramByID(overrideId);
			if (diagram != null) {
				return diagram;
			}
		}
	} catch (e) {
		/* fallthrough */
	}
	return null;
}

function saveRtfAsPdf(rtfContent, pdfFileName, baseFolderPath) {
    var pdfFilePath = "";
    var fso = null;
    var wordApp = null;
    var tempRtfPath = "";

    try {
        fso = new ActiveXObject("Scripting.FileSystemObject");
        var pdfsDir = fso.BuildPath(baseFolderPath, "pdfs");
        if (!fso.FolderExists(pdfsDir)) {
            fso.CreateFolder(pdfsDir);
        }
        
        var finalPdfPath = fso.BuildPath(pdfsDir, pdfFileName);

        // Get the path to the system's temporary folder
        var tempFolder = fso.GetSpecialFolder(2); // 2 = TemporaryFolder
        tempRtfPath = fso.BuildPath(tempFolder, fso.GetTempName() + ".rtf");

        // Step 1: Write the RTF content to a temporary file.
        // The RTF string from EA might have double-escaped backslashes. Let's correct it.
        var correctedRtf = rtfContent.replace(/\\\\/g, "\\");
        var tempFile = fso.CreateTextFile(tempRtfPath, true, false); // Unicode = false
        tempFile.Write(correctedRtf);
        tempFile.Close();
        
        // Step 2: Use Word Automation to convert RTF to PDF.
        // This requires MS Word to be installed.
        wordApp = new ActiveXObject("Word.Application");
        wordApp.Visible = false;
        
        var doc = wordApp.Documents.Open(tempRtfPath);
        
        // wdFormatPDF = 17
        doc.SaveAs2(finalPdfPath, 17);
        doc.Close(0); // 0 = wdDoNotSaveChanges
        
        pdfFilePath = pdfFileName; // Success, return the relative filename
    } catch (e) {
        Session.Output("ERROR converting RTF to PDF for " + pdfFileName + ": " + e.message);
        Session.Output("Please ensure Microsoft Word is installed and configured correctly.");
        pdfFilePath = ""; // Indicate failure
    } finally {
        // Step 3: Clean up.
        if (wordApp) {
            wordApp.Quit();
        }
        if (fso && tempRtfPath != "" && fso.FileExists(tempRtfPath)) {
            fso.DeleteFile(tempRtfPath);
        }
    }
    
    return pdfFilePath;
}

var globalElements = {};
var globalRelationships = {};
var globalViews = [];

function shouldExportDiagramLink(link) {
	return link != null && !link.IsHidden;
}

function selectCurrentEaJson(extractedJson, extractedCount, importedSnapshotJson) {
	if (extractedCount > 0) {
		return extractedJson;
	}
	if (importedSnapshotJson != "" && importedSnapshotJson != "[]") {
		return importedSnapshotJson;
	}
	return extractedJson;
}

function selectCurrentEaArray(extractedValues, importedSnapshotValues) {
	if (extractedValues.length > 0) {
		return extractedValues;
	}
	return schemaIdArrayToJsonStrings(importedSnapshotValues);
}

function extractFromDiagram(currentDiagram) {
    var viewName = currentDiagram.Name;
    var viewNotes = currentDiagram.Notes;
	
    var includedElements = [];
    var includedRelationships = [];

    // Process all diagram objects (nodes)
    var diaObjs as EA.Collection;
    diaObjs = currentDiagram.DiagramObjects;

    for (var i = 0; i < diaObjs.Count; i++) {
        var diaObj as EA.DiagramObject;
        diaObj = diaObjs.GetAt(i);
        var ele as EA.Element;
        ele = Repository.GetElementByID(diaObj.ElementID);
		
		if (ele.AssociationClassConnectorID != 0) continue;
		
		var id = getElementIdentifier(ele);
		includedElements.push('"' + jsonEscape(id) + '"');

		if (typeof globalElements[id] === "undefined") {
			globalElements[id] = "PROCESSING"; // Prevent infinite recursion
			Session.Output("Processing:" + ele.Name + " id:" + id);
			var attrs as EA.Collection;
			attrs = ele.AttributesEx;
			var attributesJsonStrings = [];
			
			for (var j = 0; j < attrs.Count; j++) {
				var attr as EA.Attribute;
				attr = attrs.GetAt(j);
				
				if (attr.Alias == "notpub") {
					continue;
				}
				if ((attr.Alias == "content") && needContent) {
					var content = "";
					if (attr.Notes != "") {
						content = getCode(resolveContentPath(attr.Notes));
					}
					if (content != "" && needContent) {
						attributesJsonStrings.push(
							'{\n' +
							'"name": "' + jsonEscape(attr.Name) + '",\n' +
							'"content": "' + jsonEscape(content) + '"\n' +
							'}'
						);
					}
				} else {
					var attbbbjss = '{\n"name": "' + jsonEscape(attr.Name) + '"\n';
					var attributeValue = attr.Default != "" ? attr.Default : "";
					if (attributeValue != "") {
						attbbbjss += ',"value": "' + jsonEscape(attributeValue) + '"\n';
					}
					var attributeDescription = attr.Notes != "" ? attr.Notes : "";
					if (attributeDescription != "") {
						attbbbjss += ',"description": "' + jsonEscape(attributeDescription) + '"\n';
					}
					attbbbjss += '}';
					attributesJsonStrings.push(attbbbjss);
				}
			}
			
			var mainbehavior_relativepath = "";
			var decision_condition_relativepath = "";
			var prompts_relativepath = "";
			var opers as EA.Collection;
			opers = ele.MethodsEx;
			
			for (var j = 0; j < opers.Count; j++) {
				var oper as EA.Method;
				oper = opers.GetAt(j);
				if (oper.Name == "mainbehavior" && needCode) {
					mainbehavior_relativepath = oper.Notes;
					continue;
				}
				if (oper.Name == "decision_condition" && needCode) {
					decision_condition_relativepath = oper.Notes;
					continue;
				}
				if (oper.Name == "prompts" && needCode) {
					prompts_relativepath = oper.Notes;
					continue;
				}
			}
				
			var opersJsonStrings = [];
			for (var j = 0; j < opers.Count; j++) {
				var oper as EA.Method;
				oper = opers.GetAt(j);
				
				if (oper.Name == "mainbehavior" || oper.Name == "decision_condition" || oper.Name == "prompts") {
					continue;
				}
				
				opersJsonStrings.push(
					'{\n' +
					'"name": "' + jsonEscape(oper.Name) + '",\n' +
					'"description": "' + jsonEscape(oper.Notes) + '"\n'+
					'}'
				);
			}
			
			var subDiagramJsonStrings = [];
			var subdiags as EA.Collection;
			subdiags = ele.Diagrams;
			for (var j = 0; j < subdiags.Count; j++) {
				var subdiag as EA.Diagram;
				subdiag = subdiags.GetAt(j);
				subDiagramJsonStrings.push(
					'{\n' +
					'"view_id": "' + jsonEscape(getDiagramIdentifier(subdiag)) + '",\n' +
					'"view_name": "' + jsonEscape(subdiag.Name) + '"\n' +
					'}'
				);
				extractFromDiagram(subdiag);
			}

			// START Refactoring Node JSON
			var finalnodetype = '{\n"id": "' + jsonEscape(id) + '",\n';
			finalnodetype += '"name": "' + jsonEscape(ele.Name) + '"\n';
			var schemaParent = getElementTag(ele, "schema_parent");
			if (schemaParent != "") {
				finalnodetype += ',"parent": "' + jsonEscape(schemaParent) + '"\n';
			} else if (ele.ParentID != 0) {
				var parentEle = Repository.GetElementByID(ele.ParentID);
				finalnodetype += ',"parent": "' + jsonEscape(getElementIdentifier(parentEle)) + '"\n';
			}

			var schemaAlias = getElementTag(ele, "schema_alias");
			if (schemaAlias != "") {
				finalnodetype += ',"alias": "' + jsonEscape(schemaAlias) + '"\n';
			} else if (getElementTag(ele, "schema_id") == "" && ele.Alias != "") {
				finalnodetype += ',"alias": "' + jsonEscape(ele.Alias) + '"\n';
			}
			
			var schemaClassifier = getElementTag(ele, "schema_classifier");
			if (schemaClassifier != "") {
				finalnodetype += ',"classifier": "' + jsonEscape(schemaClassifier) + '"\n';
			} else if (ele.ClassifierName != "") {
				finalnodetype += ',"classifier": "' + jsonEscape(ele.ClassifierName) + '"\n';
			}
			
			var schemaArchimateType = getElementTag(ele, "archimate_type");
			if (schemaArchimateType != "") {
				finalnodetype += ',"type": "' + jsonEscape(schemaArchimateType) + '"\n';
			} else {
				finalnodetype += ',"type": "' + jsonEscape(canonicalElementType(ele.StereotypeEx, ele.Type)) + '"\n';
			}
			
			if (ele.Notes != "") {
				finalnodetype += ',"description": "' + jsonEscape(ele.Notes) + '"\n';
			}
			
			var linkedDoc = null;
			if (needdoc) {
				linkedDoc = ele.GetLinkedDocument();
			}
			
			if (linkedDoc && linkedDoc.substring(0, 5) == "{\\rtf" && !isRtfEmpty(linkedDoc)) {
				var pdfFileName = ele.Name.replace(/[\s\/\\:*?"<>|]/g, '_') + "_" + ele.ElementID + ".pdf";
				var savedFileName = saveRtfAsPdf(linkedDoc, pdfFileName, projectPath);
				
				if (savedFileName != "") {
					attributesJsonStrings.push(
						'{\n' +
						'"name": "document",\n' +
						'"value": "pdfs/' + jsonEscape(savedFileName) + '"\n' +
						'}'
					);
				}
			}

			Array.prototype.push.apply(attributesJsonStrings, opersJsonStrings);

			var attrsjsstr = attributesJsonStrings.join(',\n');
			if (attrsjsstr != "") {
				finalnodetype += ',"attributes": [\n' + attrsjsstr + '\n]\n';
			}
			
			if (subDiagramJsonStrings.length > 0) {
				finalnodetype += ',"subdiagram_views": [\n' + subDiagramJsonStrings.join(',\n') + '\n]\n';
			}
			
			var testcasesJsonStrings = [];
			var testcases as EA.Collection;
			testcases = ele.Tests;
			for (var j = 0; j < testcases.Count; j++) {
				var testcase as EA.Test;
				testcase = testcases.GetAt(j);
				var testcaseName = safeSchemaString(testcase.Name, "");
				var testcaseDescription = safeSchemaString(testcase.Notes, testcaseName);
				var testcaseInput = safeSchemaString(testcase.Input, "N/A");
				var testcaseAcceptanceCriteria = safeSchemaString(testcase.AcceptanceCriteria, testcaseName);
				if (testcaseName == "" || testcaseDescription == "" || testcaseInput == "" || testcaseAcceptanceCriteria == "") {
					Session.Output("WARN: Skipping incomplete testcase on element " + ele.Name + " because schema-required fields are empty.");
					continue;
				}
				testcasesJsonStrings.push(
					'{\n' +
					'"name": "' + jsonEscape(testcaseName) + '",\n' +
					'"description": "' + jsonEscape(testcaseDescription) + '",\n' +
					'"type": "Acceptance Test",\n' +
					'"Input": "' + jsonEscape(testcaseInput) + '",\n' +
					'"acceptanceCriteria": "' + jsonEscape(testcaseAcceptanceCriteria) + '"' +
					(testcase.TestResults != "" ? ',\n"TestResults": "' + jsonEscape(testcase.TestResults) + '"' : '') + '\n' +
					'}'
				);
			}
			if (testcasesJsonStrings.length > 0) {
				finalnodetype += ',"testcases": [\n' + testcasesJsonStrings.join(',\n') + '\n]\n';
			}

			finalnodetype += '}';
			globalElements[id] = finalnodetype;
		}
    }

    // Process all diagram links (relations)
    var diaLinks as EA.Collection;
    diaLinks = currentDiagram.DiagramLinks;

    for (var k = 0; k < diaLinks.Count; k++) {
        var link as EA.DiagramLink;
        link = diaLinks.GetAt(k);	
		
		if (!shouldExportDiagramLink(link)) { continue;}
        var conn as EA.Connector;
        conn = Repository.GetConnectorByID(link.ConnectorID);
		
		var connId = getConnectorIdentifier(conn);
		includedRelationships.push('"' + jsonEscape(connId) + '"');

		if (typeof globalRelationships[connId] === "undefined") {
			var source as EA.Element;
			source = Repository.GetElementByID(conn.ClientID);
			var target as EA.Element;
			target = Repository.GetElementByID(conn.SupplierID);

			var relType = conn.StereotypeEx;
			
			if (relType == "") {
				relType = conn.Stereotype;
			}
			if (relType == "") {
				relType = conn.Type;
			}
			if (relType == "") {
				relType = conn.Name;
			}
			var schemaRelationshipType = getConnectorTag(conn, "archimate_relationship_type");
			if (schemaRelationshipType != "") {
				relType = schemaRelationshipType;
			}
			relType = canonicalRelationshipType(relType, conn.StereotypeEx != "" ? conn.StereotypeEx : conn.Type);
			var relName = getConnectorTag(conn, "schema_name");
			if (relName == "") {
				relName = conn.Name;
			}
			if (relName == "") {
				relName = relType;
			}
			
			var sourceSchemaName = getConnectorTag(conn, "source_name");
			var targetSchemaName = getConnectorTag(conn, "target_name");
			if (sourceSchemaName == "") {
				sourceSchemaName = source.Name;
			}
			if (targetSchemaName == "") {
				targetSchemaName = target.Name;
			}
			var statement = getConnectorTag(conn, "schema_statement");
			if (statement == "") {
				statement = sourceSchemaName + " --(" + relType + ")--> " + targetSchemaName;
			}
			var relatointypejss = '{\n"id":"' + jsonEscape(connId) + '"\n';
			relatointypejss += ',"statement":"' + jsonEscape(statement) + '"\n';
			relatointypejss += ',"name":"' + jsonEscape(relName) + '"\n';
			relatointypejss += ',"type":"' + jsonEscape(relType) + '"\n';
			
			var relationAttributesJsonStrings = [];
			var connassnotes = "";
			var relationDocumentWritten = false;

			if (conn.AssociationClass != null) {
				var assclass as EA.Element;
				assclass = conn.AssociationClass;
				connassnotes = assclass.Notes;
				var linkedDoc = null;
				if (needdoc) {
					linkedDoc = assclass.GetLinkedDocument();
				}
				
				if (linkedDoc && linkedDoc.substring(0, 5) == "{\\rtf" && !isRtfEmpty(linkedDoc)) {
					var pdfFileName = assclass.Name.replace(/[\s\/\\:*?"<>|]/g, '_') + "_" + assclass.ElementID + ".pdf";
					var savedFileName = saveRtfAsPdf(linkedDoc, pdfFileName, projectPath);
					
					if (savedFileName != "") {
						relatointypejss += ',"document": "pdfs/' + jsonEscape(savedFileName) + '"\n';
						relationDocumentWritten = true;
					}
				}
				var relAttrs as EA.Collection;
				relAttrs = assclass.AttributesEx;
				for (var l = 0; l < relAttrs.Count; l++) {
					var relAttr as EA.Attribute;
					relAttr = relAttrs.GetAt(l);
					var relAttrJson = '{\n"name": "' + jsonEscape(relAttr.Name) + '"\n';
					if (relAttr.Notes != "") {
						relAttrJson += ',"description": "' + jsonEscape(relAttr.Notes) + '"\n';
					}
					relAttrJson += '}';
					relationAttributesJsonStrings.push(relAttrJson);
				}
			}

			if ((connassnotes != "") && (conn.Notes != "")) {
				connassnotes = conn.Notes + '\r\n' + connassnotes;
			} else if (conn.Notes != "") {
				connassnotes = conn.Notes;
			}

			if (connassnotes != "") {
				relatointypejss += ',"description": "' + jsonEscape(connassnotes) + '"\n';
			}
			var schemaDocument = getConnectorTag(conn, "document");
			if (schemaDocument != "" && !relationDocumentWritten) {
				relatointypejss += ',"document": "' + jsonEscape(schemaDocument) + '"\n';
			}
			
			var relattrsss = relationAttributesJsonStrings.join(',\n');
			if (relattrsss != "") {
				relatointypejss += ',"attributes": [\n' + relattrsss + '\n]\n';
			} else {
				var schemaRelationshipAttributesJson = getConnectorTag(conn, "relationship_attributes_json");
				if (schemaRelationshipAttributesJson != "" && schemaRelationshipAttributesJson != "[]") {
					relatointypejss += ',"attributes": ' + schemaRelationshipAttributesJson + '\n';
				}
			}
			
			relatointypejss += 
				',"source_id":"' + jsonEscape(getElementIdentifier(source)) + '"\n' +
				',"target_id":"' + jsonEscape(getElementIdentifier(target)) + '"\n' + 
				',"source_name":"' + jsonEscape(sourceSchemaName) + '"\n' +
				',"target_name":"' + jsonEscape(targetSchemaName) + '"\n' + 
				'}';
			globalRelationships[connId] = relatointypejss;
		}
    }

	var currentDiagramId = getDiagramIdentifier(currentDiagram);
	var viewJson = '{\n"view_id": "' + jsonEscape(currentDiagramId) + '",\n';
	viewJson += '"view_name": "' + jsonEscape(viewName) + '"\n';
	Session.Output("Processing diag:" + viewName + " id:" + currentDiagramId);

	if (currentDiagram.ParentID != 0) {
		var parentElement as EA.Element;
		parentElement = Repository.GetElementByID(currentDiagram.ParentID);
		if (parentElement != null) {
			var schemaParentElementId = getStyleToken(currentDiagram.StyleEx, "schema_parent_element_id");
			var schemaParentElementName = getStyleToken(currentDiagram.StyleEx, "schema_parent_element_name");
			if (schemaParentElementId == "") {
				schemaParentElementId = getElementIdentifier(parentElement);
			}
			if (schemaParentElementName == "") {
				schemaParentElementName = parentElement.Name;
			}
			viewJson += ',"parent_element_id": "' + jsonEscape(schemaParentElementId) + '"\n';
			viewJson += ',"parent_element_name": "' + jsonEscape(schemaParentElementName) + '"\n';
		}
	}
	
	if (viewNotes != "") {
		viewJson += ',"description": "' + jsonEscape(viewNotes) + '"\n';
	}
	var schemaIncludedElementsJson = getDiagramTag(currentDiagram, "schema_included_elements_json");
	var schemaIncludedRelationshipsJson = getDiagramTag(currentDiagram, "schema_included_relationships_json");
	var schemaIncludedElements = getStyleJsonArray(currentDiagram.StyleEx, "schema_included_elements_json");
	var schemaIncludedRelationships = getStyleJsonArray(currentDiagram.StyleEx, "schema_included_relationships_json");
	if (schemaIncludedElementsJson != "" && schemaIncludedElements != null) {
		includedElements = selectCurrentEaArray(includedElements, schemaIncludedElements);
	}
	if (schemaIncludedRelationshipsJson != "" && schemaIncludedRelationships != null) {
		includedRelationships = selectCurrentEaArray(includedRelationships, schemaIncludedRelationships);
	}
	viewJson += ',"included_elements": [\n' + includedElements.join(',\n') + '\n]\n';
	viewJson += ',"included_relationships": [\n' + includedRelationships.join(',\n') + '\n]\n';
	viewJson += '}';
	
	globalViews.push(viewJson);
}

function isRtfEmpty(rtfContent) {
	//Session.Output(rtfContent);
    // 1. Safety check
    if (rtfContent == null || typeof(rtfContent) == "undefined") {
        return true;
    }
    
    var s = String(rtfContent);

    // 2. KEY FIX: Isolate the Body
    // EA separates the metadata headers (fonts, styles, lists) from the actual content
    // using the "\sectd" command. We discard everything before the last "\sectd".
    var splitIndex = s.lastIndexOf("\\sectd");
    if (splitIndex > -1) {
        s = s.substring(splitIndex);
    } else {
        // Fallback: If no section found, manually strip the noisy groups defined in your input
        // Note: We use [\s\S]*? to match across newlines
        s = s.replace(/\{\\fonttbl[\s\S]*?\}/g, "");
        s = s.replace(/\{\\colortbl[\s\S]*?\}/g, "");
        s = s.replace(/\{\\stylesheet[\s\S]*?\}/g, "");
        // Your input has lists with asterisk: {\*\listtable...}
        s = s.replace(/\{\\\*\\listtable[\s\S]*?\}/g, ""); 
        s = s.replace(/\{\\\*\\listoverridetable[\s\S]*?\}/g, "");
        s = s.replace(/\{\\\*\\revtbl[\s\S]*?\}/g, "");
    }

    // 3. Remove all RTF command words (e.g. \par, \plain, \fs20, \lang1033)
    // Matches backslash followed by alphanumeric characters or hyphen
    s = s.replace(/\\[a-z0-9\-]+/ig, " ");

    // 4. Remove leftover braces and common punctuation inside tags
    s = s.replace(/[{};]/g, " ");

    // 5. Remove newlines and tabs
    s = s.replace(/[\r\n\t]+/g, " ");

    // 6. Trim whitespace (JScript compatible regex)
    s = s.replace(/^\s+|\s+$/g, "");

    // 7. Check if anything is left
    return s.length === 0;
}

function logGlobalRuntimeConfig() {
	Session.Output("==== EA_AUTOGEN Global Vars ====");
	Session.Output("projectPath=" + projectPath);
	Session.Output("needCode=" + needCode);
	Session.Output("needContent=" + needContent);
	Session.Output("needdoc=" + needdoc);
	Session.Output("needallmaintenace=" + needallmaintenace);
	Session.Output("needbrowserlocation=" + needbrowserlocation);
	Session.Output("maintenacetype=" + maintenacetype);
	if (typeof EA_AUTOGEN_CONFIG != "undefined" && EA_AUTOGEN_CONFIG != null) {
		Session.Output("EA_AUTOGEN_CONFIG=present");
	} else {
		Session.Output("EA_AUTOGEN_CONFIG=missing");
	}
	Session.Output("===============================");
}

function main() {
    // Show the script output window
    Repository.EnsureOutputVisible("Script");
    Session.Output("Starting diagram to JSON export...");
	logGlobalRuntimeConfig();

    // Get the currently open diagram
    var currentDiagram as EA.Diagram;
    currentDiagram = resolveHeadlessDiagram();
    if (currentDiagram == null) {
        currentDiagram = Repository.GetCurrentDiagram();
    }

    if (!currentDiagram) {
        Session.Output("Error: No diagram is currently open. Aborting script.");
        return;
    }

    //Session.Output("Processing diagram: " + currentDiagram.Name);

    // --- FILE SELECTION ---
    // Prompt the user to select a save location for the JSON file.
	var now = new Date();
	var timestamp = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate() +
					"_" + now.getHours() + "_" + now.getMinutes() + "_" + now.getSeconds();
    var defaultFilename = currentDiagram.Name.replace(/[\s\/\\:*?"<>|]/g, '_') + ".json";
    var filePath = "";
    if (typeof EA_HEADLESS_OUTPUT != "undefined" && EA_HEADLESS_OUTPUT != "") {
        filePath = "" + EA_HEADLESS_OUTPUT; // 无头覆盖：直接写指定导出文件
    } else {
        filePath = projectPath;
        filePath += "design\\KG\\";
        filePath += defaultFilename;
    }
	Session.Output("filePath:" + filePath);
    // If the user cancelled the dialog, filePath will be empty.
    if (filePath == "") {
        Session.Output("User cancelled file selection. Aborting script.");
        return;
    }
	var loadedElements = {}; // Map to track elements by name
    //Session.Output("User selected file path: " + filePath);
	var ppkg as EA.Package;
	ppkg = Repository.GetPackageByID(currentDiagram.PackageID);
	var ppele as EA.Element;
	ppele = null;
	//Session.Output("currentDiagram.ParentID:" + currentDiagram.ParentID);
	if (currentDiagram.ParentID != 0) {
		ppele = Repository.GetElementByID(currentDiagram.ParentID);
	}
	
	var finalJsonString = '{\n';
	var packageElement = null;
	var rootRelationshipsJson = "";
	var rootViewsJson = "";
	
	if (ppele == null) {
		try {
			packageElement = ppkg.Element;
		} catch (ignore) {
			packageElement = null;
		}
		var rootName = packageElement != null ? getElementTag(packageElement, "schema_root_name") : "";
		var rootDescription = packageElement != null ? getElementTag(packageElement, "schema_root_description") : "";
		if (rootName == "") {
			rootName = ppkg.Name;
		}
		if (rootDescription == "") {
			rootDescription = safeSchemaString(ppkg.Notes, "Exported from EA package " + ppkg.Name);
		}
		finalJsonString += '"name": "' + jsonEscape(rootName) + '",\n';
		finalJsonString += '"description": "' + jsonEscape(rootDescription) + '",\n';
		var rootAttributesJson = packageElement != null ? getElementTag(packageElement, "schema_root_attributes_json") : "";
		if (rootAttributesJson != "" && rootAttributesJson != "[]") {
			finalJsonString += '"attributes": ' + rootAttributesJson + ',\n';
		}
		rootRelationshipsJson = packageElement != null ? getElementTag(packageElement, "schema_relationships_json") : "";
		rootViewsJson = packageElement != null ? getElementTag(packageElement, "schema_views_json") : "";
	} else {
		finalJsonString += '"name": "' + jsonEscape(ppele.Name) + '",\n';
		finalJsonString += '"description": "' + jsonEscape(safeSchemaString(ppele.Notes, "Exported from EA element " + ppele.Name)) + '",\n';
		
		var attrs as EA.Collection;
		attrs = ppele.AttributesEx;
		var attributesJsonStrings = [];
		//Session.Output("ppele attrs: \n");
		for (var j = 0; j < attrs.Count; j++) {
			var attr as EA.Attribute;
			attr = attrs.GetAt(j);
			//Session.Output("attr: \n" + attr.Name);
			if (attr.Alias == "notpub") {
				continue;
			}
			if ((attr.Alias == "content") && needContent) {
				//Session.Output(ppele.Name + " - find content:" + attr.Notes + " needContent:" + needContent);
				var content = "";
				if (attr.Notes != "") {
					content = getCode(resolveContentPath(attr.Notes));
				}
				if (content != "" && needContent) {
					attributesJsonStrings.push(
						'{\n' +
						'"name": "' + jsonEscape(attr.Name) + '",\n' +
						'"content": "' + jsonEscape(content) + '"\n' +
						'}'
					);
				}
			} else {
				var attbbbjss = '{\n"name": "' + jsonEscape(attr.Name) + '"\n';
				var attributeValue = attr.Notes != "" ? attr.Notes : attr.Default;
				if (attributeValue != "") {
					attbbbjss += ',"value": "' + jsonEscape(attributeValue) + '"\n';
				}
				attbbbjss += '}';
				attributesJsonStrings.push(attbbbjss);
			}
		}
		
		var attrsjsstr = attributesJsonStrings.join(',\n');
		if (attrsjsstr != "") {
			finalJsonString += '"attributes": [\n' + attrsjsstr + '\n],\n';
		}
	}

    extractFromDiagram(currentDiagram);

	var elementsArray = [];
	for (var key in globalElements) {
		if (globalElements.hasOwnProperty(key)) {
			elementsArray.push(globalElements[key]);
		}
	}

	var relationshipsArray = [];
	for (var key in globalRelationships) {
		if (globalRelationships.hasOwnProperty(key)) {
			relationshipsArray.push(globalRelationships[key]);
		}
	}
	var relationshipsJson = '[\n' + relationshipsArray.join(',\n') + '\n]';
	relationshipsJson = selectCurrentEaJson(relationshipsJson, relationshipsArray.length, rootRelationshipsJson);
	var viewsJson = '[\n' + globalViews.join(',\n') + '\n]';
	viewsJson = selectCurrentEaJson(viewsJson, globalViews.length, rootViewsJson);

	finalJsonString += '"elements": [\n' + elementsArray.join(',\n') + '\n],\n';
	finalJsonString += '"relationships": ' + relationshipsJson + ',\n';
	finalJsonString += '"views": ' + viewsJson + '\n';
    finalJsonString += '}';
    // --- FILE WRITING (UTF-8 WITHOUT BOM) ---
    try {
        // Ensure directory exists
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        var folderPath = fso.GetParentFolderName(filePath);
        var foldersToCreate = [];
        var currFolder = folderPath;
        while (currFolder != "" && !fso.FolderExists(currFolder)) {
            foldersToCreate.unshift(currFolder);
            currFolder = fso.GetParentFolderName(currFolder);
        }
        for (var i = 0; i < foldersToCreate.length; i++) {
            fso.CreateFolder(foldersToCreate[i]);
        }

        // Step 1: Write the text to a temporary text stream, which includes the BOM
        var textStream = new ActiveXObject("ADODB.Stream");
        textStream.Type = 2; // Text
        textStream.Charset = "utf-8";
        textStream.Open();
        textStream.WriteText(finalJsonString);
        
        // Step 2: Move the stream's position past the 3-byte BOM
        textStream.Position = 3; 
        
        // Step 3: Copy the BOM-less content to a second, binary stream
        var binaryStream = new ActiveXObject("ADODB.Stream");
        binaryStream.Type = 1; // Binary
        binaryStream.Open();
        textStream.CopyTo(binaryStream);

        // Step 4: Save the clean binary stream to the file
        binaryStream.SaveToFile(filePath, 2); // 2 = Create or Overwrite
        
        // Clean up
        textStream.Close();
        binaryStream.Close();
        
        Session.Output("=======================================");
        Session.Output("Success! UTF-8 (no BOM) JSON data written to file.");
    }
    catch(e) {
        Session.Output("=======================================");
        Session.Output("ERROR: Could not write to file. " + e.message);
        if (e.message.indexOf("ADODB.Stream") > -1) {
             Session.Output("This script requires the ADO components to be available on the system.");
        }
    }
}

var projectPath = "";
var needCode = false;
var needContent = true;
var needdoc = false;
var needallmaintenace = "All";
var needbrowserlocation = true;
var maintenacetype = "forproject"; // forllm forproject

function applyRuntimeConfig() {
	if (typeof EA_AUTOGEN_CONFIG == "undefined" || EA_AUTOGEN_CONFIG == null) {
		return;
	}

	if (typeof EA_AUTOGEN_CONFIG.projectPath != "undefined") {
		projectPath = EA_AUTOGEN_CONFIG.projectPath;
	}
	if (typeof EA_AUTOGEN_CONFIG.needCode != "undefined") {
		needCode = EA_AUTOGEN_CONFIG.needCode;
	}
	if (typeof EA_AUTOGEN_CONFIG.needContent != "undefined") {
		needContent = EA_AUTOGEN_CONFIG.needContent;
	}
	if (typeof EA_AUTOGEN_CONFIG.needdoc != "undefined") {
		needdoc = EA_AUTOGEN_CONFIG.needdoc;
	}
	if (typeof EA_AUTOGEN_CONFIG.needallmaintenace != "undefined") {
		if (EA_AUTOGEN_CONFIG.needallmaintenace === true) {
			needallmaintenace = "All";
		} else if (EA_AUTOGEN_CONFIG.needallmaintenace === false) {
			needallmaintenace = "onlyActive";
		} else {
			needallmaintenace = EA_AUTOGEN_CONFIG.needallmaintenace;
		}
	}
	if (typeof EA_AUTOGEN_CONFIG.needbrowserlocation != "undefined") {
		needbrowserlocation = EA_AUTOGEN_CONFIG.needbrowserlocation;
	}
	if (typeof EA_AUTOGEN_CONFIG.maintenacetype != "undefined") {
		maintenacetype = EA_AUTOGEN_CONFIG.maintenacetype;
	}
}

function initializeRuntimeConfig() {
	initializeAutogenConfig();
	applyRuntimeConfig();

	if (projectPath != "" && projectPath.charAt(projectPath.length - 1) != "\\" && projectPath.charAt(projectPath.length - 1) != "/") {
		projectPath += "\\";
	}
}

if (!(typeof EA_AUTOGEN_SKIP_MAIN != "undefined" && EA_AUTOGEN_SKIP_MAIN == true)) {
	initializeRuntimeConfig();
	main();
}