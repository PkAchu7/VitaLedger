// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VitaLedgerRoles.sol";

/// @title VitaLedgerAccess - Patient Consent & Key Exchange Management
/// @notice Manages patient-to-doctor access requests, consent granting, encrypted key delivery, and revocation.
contract VitaLedgerAccess {
    enum Access { None, Requested, Granted }

    address public immutable admin;
    address public hub;
    VitaLedgerRoles public immutable rolesContract;

    mapping(address => mapping(address => Access)) public access; // patient => doctor => Access
    mapping(address => mapping(address => bytes)) private _wrappedKeys; // patient => doctor => key

    event AccessRequested(address indexed patient, address indexed doctor);
    event AccessGranted(address indexed patient, address indexed doctor);
    event AccessDenied(address indexed patient, address indexed doctor);
    event AccessRevoked(address indexed patient, address indexed doctor);
    event AccessWithdrawn(address indexed patient, address indexed doctor);
    event HubUpdated(address indexed newHub);

    modifier onlyAdmin() {
        require(msg.sender == admin, "admin only");
        _;
    }

    modifier onlyHubOrAdmin() {
        require(msg.sender == hub || msg.sender == admin, "not authorized hub/admin");
        _;
    }

    constructor(address _admin, address _hub, address _roles) {
        admin = _admin == address(0) ? msg.sender : _admin;
        hub = _hub;
        rolesContract = VitaLedgerRoles(_roles);
    }

    function setHub(address _hub) external onlyAdmin {
        require(_hub != address(0), "zero address");
        hub = _hub;
        emit HubUpdated(_hub);
    }

    function hasAccess(address patient, address doctor) public view returns (bool) {
        return access[patient][doctor] == Access.Granted &&
               rolesContract.isActive(doctor, VitaLedgerRoles.Role.Doctor);
    }

    function requestAccess(address patient) external {
        _requestAccess(patient, msg.sender);
    }

    function requestAccessFor(address patient, address doctor) external onlyHubOrAdmin {
        _requestAccess(patient, doctor);
    }

    function _requestAccess(address patient, address doctor) private {
        require(rolesContract.isActive(doctor, VitaLedgerRoles.Role.Doctor), "not active");
        VitaLedgerRoles.User memory u = rolesContract.getUser(patient);
        require(u.role == VitaLedgerRoles.Role.Patient, "not a patient");
        require(access[patient][doctor] == Access.None, "already requested");
        access[patient][doctor] = Access.Requested;
        emit AccessRequested(patient, doctor);
    }

    function withdrawRequest(address patient) external {
        _withdrawRequest(patient, msg.sender);
    }

    function withdrawRequestFor(address patient, address doctor) external onlyHubOrAdmin {
        _withdrawRequest(patient, doctor);
    }

    function _withdrawRequest(address patient, address doctor) private {
        require(access[patient][doctor] == Access.Requested, "no request");
        access[patient][doctor] = Access.None;
        emit AccessWithdrawn(patient, doctor);
    }

    function grantAccess(address doctor, bytes calldata wrappedKey) external {
        _grantAccess(msg.sender, doctor, wrappedKey);
    }

    function grantAccessFor(address patient, address doctor, bytes calldata wrappedKey) external onlyHubOrAdmin {
        _grantAccess(patient, doctor, wrappedKey);
    }

    function _grantAccess(address patient, address doctor, bytes calldata wrappedKey) private {
        VitaLedgerRoles.User memory u = rolesContract.getUser(patient);
        require(u.role == VitaLedgerRoles.Role.Patient, "not a patient");
        require(access[patient][doctor] == Access.Requested, "no request");
        require(wrappedKey.length > 0, "key required");
        access[patient][doctor] = Access.Granted;
        _wrappedKeys[patient][doctor] = wrappedKey;
        emit AccessGranted(patient, doctor);
    }

    function denyRequest(address doctor) external {
        _denyRequest(msg.sender, doctor);
    }

    function denyRequestFor(address patient, address doctor) external onlyHubOrAdmin {
        _denyRequest(patient, doctor);
    }

    function _denyRequest(address patient, address doctor) private {
        require(access[patient][doctor] == Access.Requested, "no request");
        access[patient][doctor] = Access.None;
        emit AccessDenied(patient, doctor);
    }

    function revokeAccess(address doctor) external {
        _revokeAccess(msg.sender, doctor);
    }

    function revokeAccessFor(address patient, address doctor) external onlyHubOrAdmin {
        _revokeAccess(patient, doctor);
    }

    function _revokeAccess(address patient, address doctor) private {
        require(access[patient][doctor] == Access.Granted, "not granted");
        access[patient][doctor] = Access.None;
        delete _wrappedKeys[patient][doctor];
        emit AccessRevoked(patient, doctor);
    }

    function getWrappedKey(address patient) external view returns (bytes memory) {
        require(hasAccess(patient, msg.sender) || msg.sender == hub, "no access");
        return _wrappedKeys[patient][msg.sender];
    }

    function getWrappedKeyFor(address patient, address doctor) external view returns (bytes memory) {
        require(msg.sender == hub || msg.sender == admin, "not authorized");
        require(hasAccess(patient, doctor), "no access");
        return _wrappedKeys[patient][doctor];
    }
}
