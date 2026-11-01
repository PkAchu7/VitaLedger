// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VitaLedgerRoles.sol";
import "./VitaLedgerAccess.sol";

/// @title VitaLedgerPrescriptions - Electronic Prescriptions & Pharmacy Dispensation
/// @notice Handles digital prescription creation by licensed doctors and strictly enforces single-dispense pharmacy verification.
contract VitaLedgerPrescriptions {
    enum RxStatus { Active, Dispensed }

    struct Prescription {
        uint256 id;
        address patient;
        address doctor;
        bytes32 contentHash;
        uint64 issuedAt;
        RxStatus status;
        address dispensedBy;
        uint64 dispensedAt;
    }

    address public immutable admin;
    address public hub;
    VitaLedgerRoles public immutable rolesContract;
    VitaLedgerAccess public immutable accessContract;

    Prescription[] private _prescriptions;

    event PrescriptionIssued(uint256 indexed id, address indexed patient, address indexed doctor);
    event PrescriptionDispensed(uint256 indexed id, address indexed pharmacy);
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

    function issuePrescription(address patient, bytes32 contentHash) external returns (uint256 id) {
        return _issuePrescription(patient, msg.sender, contentHash);
    }

    function issuePrescriptionFor(address patient, address doctor, bytes32 contentHash) external onlyHubOrAdmin returns (uint256 id) {
        return _issuePrescription(patient, doctor, contentHash);
    }

    function _issuePrescription(address patient, address doctor, bytes32 contentHash) private returns (uint256 id) {
        require(rolesContract.isActive(doctor, VitaLedgerRoles.Role.Doctor), "not active");
        require(accessContract.hasAccess(patient, doctor), "no access");
        id = _prescriptions.length;
        _prescriptions.push(Prescription(
            id,
            patient,
            doctor,
            contentHash,
            uint64(block.timestamp),
            RxStatus.Active,
            address(0),
            0
        ));
        emit PrescriptionIssued(id, patient, doctor);
    }

    function dispense(uint256 id) external {
        _dispense(id, msg.sender);
    }

    function dispenseFor(uint256 id, address pharmacy) external onlyHubOrAdmin {
        _dispense(id, pharmacy);
    }

    function _dispense(uint256 id, address pharmacy) private {
        require(rolesContract.isActive(pharmacy, VitaLedgerRoles.Role.Pharmacy), "not active");
        require(id < _prescriptions.length, "unknown prescription");
        Prescription storage p = _prescriptions[id];
        require(p.status == RxStatus.Active, "already dispensed");
        p.status = RxStatus.Dispensed;
        p.dispensedBy = pharmacy;
        p.dispensedAt = uint64(block.timestamp);
        emit PrescriptionDispensed(id, pharmacy);
    }

    function getPrescription(uint256 id) external view returns (Prescription memory) {
        require(id < _prescriptions.length, "unknown prescription");
        return _prescriptions[id];
    }

    function prescriptionCount() external view returns (uint256) {
        return _prescriptions.length;
    }
}
