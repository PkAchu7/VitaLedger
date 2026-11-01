// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VitaLedgerRoles.sol";
import "./VitaLedgerAccess.sol";

/// @title VitaLedgerRecords - Medical Records Integrity & Audit Logging
/// @notice Stores IPFS content pointers, file integrity hashes, encrypted metadata, view logs, and break-glass events.
contract VitaLedgerRecords {
    struct Record {
        uint256 id;
        address author;
        string cid;
        bytes32 fileHash;
        string meta;
        uint64 createdAt;
    }

    address public immutable admin;
    address public hub;
    VitaLedgerRoles public immutable rolesContract;
    VitaLedgerAccess public immutable accessContract;

    mapping(address => Record[]) private _records; // patient => records
    mapping(address => mapping(address => uint64)) public lastViewed;
    mapping(address => mapping(address => uint64)) public lastBreakGlass;

    event RecordAdded(address indexed patient, uint256 indexed id, address indexed author);
    event RecordsViewed(address indexed patient, address indexed doctor);
    event BreakGlassUsed(address indexed patient, address indexed doctor);
    event HubUpdated(address indexed newHub);

    modifier onlyAdmin() {
        require(msg.sender == admin, "admin only");
        _;
    }

    modifier onlyHubOrAdmin() {
        require(msg.sender == hub || msg.sender == admin, "not authorized hub/admin");
        _;
    }

    constructor(address _admin, address _hub, address _roles, address _access) {
        admin = _admin == address(0) ? msg.sender : _admin;
        hub = _hub;
        rolesContract = VitaLedgerRoles(_roles);
        accessContract = VitaLedgerAccess(_access);
    }

    function setHub(address _hub) external onlyAdmin {
        require(_hub != address(0), "zero address");
        hub = _hub;
        emit HubUpdated(_hub);
    }

    function addRecord(address patient, string calldata cid, bytes32 fileHash, string calldata meta)
        external returns (uint256 id)
    {
        return _addRecord(patient, msg.sender, cid, fileHash, meta);
    }

    function addRecordFor(address patient, address author, string calldata cid, bytes32 fileHash, string calldata meta)
        external onlyHubOrAdmin returns (uint256 id)
    {
        return _addRecord(patient, author, cid, fileHash, meta);
    }

    function _addRecord(address patient, address author, string calldata cid, bytes32 fileHash, string calldata meta)
        private returns (uint256 id)
    {
        VitaLedgerRoles.User memory u = rolesContract.getUser(patient);
        require(u.role == VitaLedgerRoles.Role.Patient, "not a patient");
        if (author != patient) {
            require(accessContract.hasAccess(patient, author), "no access");
        }
        id = _records[patient].length;
        _records[patient].push(Record(id, author, cid, fileHash, meta, uint64(block.timestamp)));
        emit RecordAdded(patient, id, author);
    }

    function getRecords(address patient) external view returns (Record[] memory) {
        return _records[patient];
    }

    function logView(address patient) external {
        _logView(patient, msg.sender);
    }

    function logViewFor(address patient, address doctor) external onlyHubOrAdmin {
        _logView(patient, doctor);
    }

    function _logView(address patient, address doctor) private {
        require(rolesContract.isActive(doctor, VitaLedgerRoles.Role.Doctor), "not active");
        require(accessContract.hasAccess(patient, doctor), "no access");
        lastViewed[patient][doctor] = uint64(block.timestamp);
        emit RecordsViewed(patient, doctor);
    }

    function breakGlass(address patient) external {
        _breakGlass(patient, msg.sender);
    }

    function breakGlassFor(address patient, address doctor) external onlyHubOrAdmin {
        _breakGlass(patient, doctor);
    }

    function _breakGlass(address patient, address doctor) private {
        require(rolesContract.isActive(doctor, VitaLedgerRoles.Role.Doctor), "not active");
        VitaLedgerRoles.User memory u = rolesContract.getUser(patient);
        require(u.role == VitaLedgerRoles.Role.Patient, "not a patient");
        lastBreakGlass[patient][doctor] = uint64(block.timestamp);
        emit BreakGlassUsed(patient, doctor);
    }
}
