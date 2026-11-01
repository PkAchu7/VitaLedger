// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VitaLedgerRoles - Role-Based Access Control & User Identity
/// @notice Manages patient, doctor, hospital, and pharmacy registrations, status approvals, and suspensions.
contract VitaLedgerRoles {
    enum Role { None, Patient, Doctor, Pharmacy, Hospital }
    enum Status { None, Pending, Approved, Suspended }

    struct User {
        Role role;
        Status status;
        address hospital;
        bytes32 encKey;
    }

    address public immutable admin;
    address public hub;
    mapping(address => User) public users;
    mapping(address => bool) public adminLocked;

    event UserRegistered(address indexed user, Role role, Status status, address hospital);
    event UserStatusChanged(address indexed user, Status status, address indexed by);
    event HubUpdated(address indexed newHub);

    modifier onlyAdmin() {
        require(msg.sender == admin, "admin only");
        _;
    }

    modifier onlyHubOrAdmin() {
        require(msg.sender == hub || msg.sender == admin, "not authorized hub/admin");
        _;
    }

    constructor(address _admin, address _hub) {
        admin = _admin == address(0) ? msg.sender : _admin;
        hub = _hub;
    }

    function setHub(address _hub) external onlyAdmin {
        require(_hub != address(0), "zero address");
        hub = _hub;
        emit HubUpdated(_hub);
    }

    function isActive(address a, Role r) public view returns (bool) {
        User storage u = users[a];
        if (u.role != r || u.status != Status.Approved) return false;
        if (r == Role.Doctor) {
            User storage h = users[u.hospital];
            return h.role == Role.Hospital && h.status == Status.Approved;
        }
        return true;
    }

    function getUser(address a) external view returns (User memory) {
        return users[a];
    }

    function registerPatient(bytes32 encKey) external {
        _register(msg.sender, Role.Patient, Status.Approved, address(0), encKey);
    }

    function applyHospital(bytes32 encKey) external {
        _register(msg.sender, Role.Hospital, Status.Pending, address(0), encKey);
    }

    function applyPharmacy(bytes32 encKey) external {
        _register(msg.sender, Role.Pharmacy, Status.Pending, address(0), encKey);
    }

    function applyDoctor(address hospital, bytes32 encKey) external {
        require(users[hospital].role == Role.Hospital, "unknown hospital");
        _register(msg.sender, Role.Doctor, Status.Pending, hospital, encKey);
    }

    function registerFor(address user, Role role, Status status, address hospital, bytes32 encKey) external onlyHubOrAdmin {
        if (role == Role.Doctor) {
            require(users[hospital].role == Role.Hospital, "unknown hospital");
        }
        _register(user, role, status, hospital, encKey);
    }

    function _register(address user, Role role, Status status, address hospital, bytes32 encKey) private {
        require(user != admin, "admin wallet");
        require(users[user].role == Role.None, "already registered");
        require(encKey != bytes32(0), "key required");
        users[user] = User(role, status, hospital, encKey);
        emit UserRegistered(user, role, status, hospital);
    }

    function approve(address user) external {
        _approve(user, msg.sender);
    }

    function approveFor(address user, address caller) external onlyHubOrAdmin {
        _approve(user, caller);
    }

    function _approve(address user, address caller) private {
        User storage u = users[user];
        require(u.status == Status.Pending || u.status == Status.Suspended, "not approvable");
        if (caller == admin) {
            adminLocked[user] = false;
        } else {
            require(!adminLocked[user], "locked by admin");
            if (u.role == Role.Doctor) {
                require(caller == u.hospital && isActive(caller, Role.Hospital), "not your doctor");
            } else if (u.role == Role.Pharmacy) {
                require(isActive(caller, Role.Hospital), "hospital only");
            } else {
                revert("admin only");
            }
        }
        u.status = Status.Approved;
        emit UserStatusChanged(user, Status.Approved, caller);
    }

    function suspend(address user) external {
        _suspend(user, msg.sender);
    }

    function suspendFor(address user, address caller) external onlyHubOrAdmin {
        _suspend(user, caller);
    }

    function _suspend(address user, address caller) private {
        User storage u = users[user];
        require(u.status == Status.Approved || u.status == Status.Pending, "not suspendable");
        require(u.role != Role.Patient && u.role != Role.None, "invalid role");
        if (caller == admin) {
            adminLocked[user] = true;
        } else if (u.role == Role.Doctor) {
            require(caller == u.hospital && isActive(caller, Role.Hospital), "not your doctor");
        } else if (u.role == Role.Pharmacy) {
            require(isActive(caller, Role.Hospital), "hospital only");
        } else {
            revert("admin only");
        }
        u.status = Status.Suspended;
        emit UserStatusChanged(user, Status.Suspended, caller);
    }
}
