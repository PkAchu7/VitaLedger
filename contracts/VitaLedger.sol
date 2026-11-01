// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VitaLedgerRoles.sol";
import "./VitaLedgerAccess.sol";
import "./VitaLedgerRecords.sol";
import "./VitaLedgerPrescriptions.sol";

/// @title VitaLedger - Decentralized Healthcare Gateway & Master Hub
/// @notice Central orchestrator connecting modular micro-contracts:
/// 1. VitaLedgerRoles: Identity, RBAC & Organization Verifications
/// 2. VitaLedgerAccess: Consent Governance & Public Key Wrapping
/// 3. VitaLedgerRecords: IPFS Anchoring, File Integrity & Emergency Audits
/// 4. VitaLedgerPrescriptions: Cryptographic Prescriptions & Single-Dispense
contract VitaLedger {
    enum Role { None, Patient, Doctor, Pharmacy, Hospital }
    enum Status { None, Pending, Approved, Suspended }
    enum Access { None, Requested, Granted }
    enum RxStatus { Active, Dispensed }

    struct User { Role role; Status status; address hospital; bytes32 encKey; }
    struct Record { uint256 id; address author; string cid; bytes32 fileHash; string meta; uint64 createdAt; }
    struct Prescription {
        uint256 id; address patient; address doctor; bytes32 contentHash;
        uint64 issuedAt; RxStatus status; address dispensedBy; uint64 dispensedAt;
    }

    address public immutable admin;

    // Subsystem Module Contracts
    VitaLedgerRoles public immutable rolesContract;
    VitaLedgerAccess public immutable accessContract;
    VitaLedgerRecords public immutable recordsContract;
    VitaLedgerPrescriptions public immutable prescriptionsContract;

    event UserRegistered(address indexed user, Role role, Status status, address hospital);
    event UserStatusChanged(address indexed user, Status status, address indexed by);
    event AccessRequested(address indexed patient, address indexed doctor);
    event AccessGranted(address indexed patient, address indexed doctor);
    event AccessDenied(address indexed patient, address indexed doctor);
    event AccessRevoked(address indexed patient, address indexed doctor);
    event AccessWithdrawn(address indexed patient, address indexed doctor);
    event RecordAdded(address indexed patient, uint256 indexed id, address indexed author);
    event RecordsViewed(address indexed patient, address indexed doctor);
    event BreakGlassUsed(address indexed patient, address indexed doctor);
    event PrescriptionIssued(uint256 indexed id, address indexed patient, address indexed doctor);
    event PrescriptionDispensed(uint256 indexed id, address indexed pharmacy);

    constructor() {
        admin = msg.sender;
        
        // Deploy all modular subsystem contracts with this Hub pre-authorized
        VitaLedgerRoles roles = new VitaLedgerRoles(msg.sender, address(this));
        VitaLedgerAccess _access = new VitaLedgerAccess(msg.sender, address(this), address(roles));
        VitaLedgerRecords records = new VitaLedgerRecords(msg.sender, address(this), address(roles), address(_access));
        VitaLedgerPrescriptions prescriptions = new VitaLedgerPrescriptions(msg.sender, address(this), address(roles), address(_access));

        rolesContract = roles;
        accessContract = _access;
        recordsContract = records;
        prescriptionsContract = prescriptions;
    }

    // ---------------------------------------------------------------- Users & RBAC
    function users(address a) external view returns (Role role, Status status, address hospital, bytes32 encKey) {
        VitaLedgerRoles.User memory u = rolesContract.getUser(a);
        return (Role(uint8(u.role)), Status(uint8(u.status)), u.hospital, u.encKey);
    }

    function adminLocked(address a) external view returns (bool) {
        return rolesContract.adminLocked(a);
    }

    function isActive(address a, uint8 r) external view returns (bool) {
        return rolesContract.isActive(a, VitaLedgerRoles.Role(r));
    }

    function registerPatient(bytes32 encKey) external {
        rolesContract.registerFor(msg.sender, VitaLedgerRoles.Role.Patient, VitaLedgerRoles.Status.Approved, address(0), encKey);
        emit UserRegistered(msg.sender, Role.Patient, Status.Approved, address(0));
    }

    function applyHospital(bytes32 encKey) external {
        rolesContract.registerFor(msg.sender, VitaLedgerRoles.Role.Hospital, VitaLedgerRoles.Status.Pending, address(0), encKey);
        emit UserRegistered(msg.sender, Role.Hospital, Status.Pending, address(0));
    }

    function applyPharmacy(bytes32 encKey) external {
        rolesContract.registerFor(msg.sender, VitaLedgerRoles.Role.Pharmacy, VitaLedgerRoles.Status.Pending, address(0), encKey);
        emit UserRegistered(msg.sender, Role.Pharmacy, Status.Pending, address(0));
    }

    function applyDoctor(address hospital, bytes32 encKey) external {
        rolesContract.registerFor(msg.sender, VitaLedgerRoles.Role.Doctor, VitaLedgerRoles.Status.Pending, hospital, encKey);
        emit UserRegistered(msg.sender, Role.Doctor, Status.Pending, hospital);
    }

    function approve(address user) external {
        rolesContract.approveFor(user, msg.sender);
        emit UserStatusChanged(user, Status.Approved, msg.sender);
    }

    function suspend(address user) external {
        rolesContract.suspendFor(user, msg.sender);
        emit UserStatusChanged(user, Status.Suspended, msg.sender);
    }

    // ---------------------------------------------------------------- Access Control
    function hasAccess(address patient, address doctor) external view returns (bool) {
        return accessContract.hasAccess(patient, doctor);
    }

    function access(address patient, address doctor) external view returns (Access) {
        return Access(uint8(accessContract.access(patient, doctor)));
    }

    function requestAccess(address patient) external {
        accessContract.requestAccessFor(patient, msg.sender);
        emit AccessRequested(patient, msg.sender);
    }

    function withdrawRequest(address patient) external {
        accessContract.withdrawRequestFor(patient, msg.sender);
        emit AccessWithdrawn(patient, msg.sender);
    }

    function grantAccess(address doctor, bytes calldata wrappedKey) external {
        accessContract.grantAccessFor(msg.sender, doctor, wrappedKey);
        emit AccessGranted(msg.sender, doctor);
    }

    function denyRequest(address doctor) external {
        accessContract.denyRequestFor(msg.sender, doctor);
        emit AccessDenied(msg.sender, doctor);
    }

    function revokeAccess(address doctor) external {
        accessContract.revokeAccessFor(msg.sender, doctor);
        emit AccessRevoked(msg.sender, doctor);
    }

    function getWrappedKey(address patient) external view returns (bytes memory) {
        return accessContract.getWrappedKeyFor(patient, msg.sender);
    }

    // ---------------------------------------------------------------- Records
    function addRecord(address patient, string calldata cid, bytes32 fileHash, string calldata meta)
        external returns (uint256 id)
    {
        id = recordsContract.addRecordFor(patient, msg.sender, cid, fileHash, meta);
        emit RecordAdded(patient, id, msg.sender);
    }

    function getRecords(address patient) external view returns (Record[] memory) {
        VitaLedgerRecords.Record[] memory r = recordsContract.getRecords(patient);
        Record[] memory out = new Record[](r.length);
        for (uint256 i = 0; i < r.length; i++) {
            out[i] = Record(r[i].id, r[i].author, r[i].cid, r[i].fileHash, r[i].meta, r[i].createdAt);
        }
        return out;
    }

    function logView(address patient) external {
        recordsContract.logViewFor(patient, msg.sender);
        emit RecordsViewed(patient, msg.sender);
    }

    function breakGlass(address patient) external {
        recordsContract.breakGlassFor(patient, msg.sender);
        emit BreakGlassUsed(patient, msg.sender);
    }

    function lastViewed(address patient, address doctor) external view returns (uint64) {
        return recordsContract.lastViewed(patient, doctor);
    }

    function lastBreakGlass(address patient, address doctor) external view returns (uint64) {
        return recordsContract.lastBreakGlass(patient, doctor);
    }

    // ---------------------------------------------------------------- Prescriptions
    function issuePrescription(address patient, bytes32 contentHash) external returns (uint256 id) {
        id = prescriptionsContract.issuePrescriptionFor(patient, msg.sender, contentHash);
        emit PrescriptionIssued(id, patient, msg.sender);
    }

    function dispense(uint256 id) external {
        prescriptionsContract.dispenseFor(id, msg.sender);
        emit PrescriptionDispensed(id, msg.sender);
    }

    function getPrescription(uint256 id) external view returns (Prescription memory) {
        VitaLedgerPrescriptions.Prescription memory p = prescriptionsContract.getPrescription(id);
        return Prescription(
            p.id,
            p.patient,
            p.doctor,
            p.contentHash,
            p.issuedAt,
            RxStatus(uint8(p.status)),
            p.dispensedBy,
            p.dispensedAt
        );
    }

    function prescriptionCount() external view returns (uint256) {
        return prescriptionsContract.prescriptionCount();
    }
}
