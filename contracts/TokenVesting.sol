// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CryptoSnack Vesting
 */
contract CryptoSnackVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct VestingSchedule {
        uint256 totalAmount;
        uint256 startTime;
        uint256 cliff;
        uint256 duration;
        uint256 releasedAmount;
        bool revocable;
        bool revoked;
    }

    // Constants
    uint32 private constant MAX_START_OFFSET_TIME = 365 days;
    uint32 private constant MAX_VESTING_TIME = 10 * 365 days;

    // Errors
    error InvalidBeneficiary();
    error NoVestingSchedule();
    error InvalidVestingParameters();
    error InsufficientTokenBalance();
    error NotRevocable();
    error NothingToRelease();
    error TransferFailed();
    error InvalidScheduleIndex();
    error NoRevocableSchedules();

    // Events
    event VestingScheduleCreated(
        address indexed beneficiary,
        uint256 indexed scheduleIndex,
        uint256 amount,
        uint256 startTime,
        uint256 cliff,
        uint256 duration
    );
    event TokensReleased(address indexed beneficiary, uint256 amount);
    event TokensRefunded(address indexed beneficiary, uint256 indexed scheduleIndex, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 indexed scheduleIndex);
    event TokenReclaimed(address indexed token, address indexed to, uint256 value);
    event BNBReclaimed(address indexed to, uint256 value);

    // State variables
    mapping(address => VestingSchedule[]) private _vestingSchedules;
    uint256 private _totalAllocated;

    // Token parameters
    IERC20 private immutable _token;

    constructor(address tokenAddress) Ownable(msg.sender) {
        _token = IERC20(tokenAddress);
    }

    // Views
    function getToken() external view returns (IERC20) {
        return _token;
    }

    function getVestingSchedules(address beneficiary) external view returns (VestingSchedule[] memory) {
        return _vestingSchedules[beneficiary];
    }

    function getVestingScheduleCount(address beneficiary) external view returns (uint256) {
        return _vestingSchedules[beneficiary].length;
    }

    function getTotalAllocated() external view returns (uint256) {
        return _totalAllocated;
    }

    // Vesting
    function createVestingSchedule(
        address beneficiary,
        uint256 amount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external onlyOwner {
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (amount == 0) revert InvalidVestingParameters();
        if (startTime < block.timestamp) revert InvalidVestingParameters();
        if (startTime > block.timestamp + MAX_START_OFFSET_TIME) revert InvalidVestingParameters();
        if (cliffDuration == 0) revert InvalidVestingParameters();
        if (vestingDuration == 0) revert InvalidVestingParameters();
        if (cliffDuration > vestingDuration) revert InvalidVestingParameters();
        if (vestingDuration > MAX_VESTING_TIME) revert InvalidVestingParameters();
        if (_token.balanceOf(address(this)) < amount + _totalAllocated) revert InsufficientTokenBalance();

        uint256 cliff = startTime + cliffDuration;

        _vestingSchedules[beneficiary].push(VestingSchedule({
            totalAmount: amount,
            startTime: startTime,
            cliff: cliff,
            duration: vestingDuration,
            releasedAmount: 0,
            revocable: revocable,
            revoked: false
        }));

        _totalAllocated += amount;

        uint256 idx = _vestingSchedules[beneficiary].length - 1;
        emit VestingScheduleCreated(
            beneficiary,
            idx,
            amount,
            startTime,
            cliff,
            vestingDuration
        );
    }

    /// @notice Releases all currently releasable tokens across all schedules for msg.sender in a single transfer.
    function release() external nonReentrant {
        address beneficiary = msg.sender;
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];

        if (schedules.length == 0) revert NoVestingSchedule();

        uint256 totalReleasable = 0;
        uint256 i = 0;
        while (i < schedules.length) {
            VestingSchedule storage schedule = schedules[i];
            uint256 releasable = _getReleasableAmountForSchedule(schedule);
            if (releasable > 0) {
                schedule.releasedAmount += releasable;
                totalReleasable += releasable;
            }
            if (schedule.releasedAmount == schedule.totalAmount) {
                schedules[i] = schedules[schedules.length - 1];
                schedules.pop();
                // do not increment i; check the swapped-in element next
            } else {
                i++;
            }
        }

        if (totalReleasable == 0) revert NothingToRelease();

        _totalAllocated -= totalReleasable;
        _token.safeTransfer(beneficiary, totalReleasable);
        emit TokensReleased(beneficiary, totalReleasable);
    }

    /// @notice Revokes a specific schedule by index. Pays releasable to beneficiary and refunds remainder to owner.
    function revokeSchedule(address beneficiary, uint256 scheduleIndex) external onlyOwner nonReentrant {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];

        if (scheduleIndex >= schedules.length) revert InvalidScheduleIndex();

        VestingSchedule storage schedule = schedules[scheduleIndex];
        if (!schedule.revocable) revert NotRevocable();

        _revokeOne(beneficiary, scheduleIndex);
    }

    /// @notice Revokes all revocable schedules for a beneficiary, skipping non-revocable ones.
    function revokeAll(address beneficiary) external onlyOwner nonReentrant {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];

        if (schedules.length == 0) revert NoVestingSchedule();

        bool anyRevoked = false;
        uint256 i = 0;
        while (i < schedules.length) {
            if (!schedules[i].revocable) {
                i++;
                continue;
            }
            _revokeOne(beneficiary, i);
            anyRevoked = true;
            // _revokeOne removes element i via swap-and-pop; do not increment i
        }

        if (!anyRevoked) revert NoRevocableSchedules();
    }

    /// @dev Settles and removes the schedule at `index` (swap-and-pop). Assumes index is valid and schedule is revocable.
    function _revokeOne(address beneficiary, uint256 index) private {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        VestingSchedule storage schedule = schedules[index];

        uint256 releasable = _getReleasableAmountForSchedule(schedule);
        if (releasable > 0) {
            _totalAllocated -= releasable;
            _token.safeTransfer(beneficiary, releasable);
            emit TokensReleased(beneficiary, releasable);
        }

        uint256 remaining = schedule.totalAmount - schedule.releasedAmount - releasable;
        if (remaining > 0) {
            _totalAllocated -= remaining;
            _token.safeTransfer(owner(), remaining);
            emit TokensRefunded(beneficiary, index, remaining);
        }

        emit VestingRevoked(beneficiary, index);

        // Swap-and-pop removal
        schedules[index] = schedules[schedules.length - 1];
        schedules.pop();
    }

    function _getReleasableAmountForSchedule(VestingSchedule memory schedule) private view returns (uint256) {
        if (block.timestamp < schedule.cliff) {
            return 0;
        }

        uint256 vestedAmount;
        if (block.timestamp >= schedule.startTime + schedule.duration) {
            vestedAmount = schedule.totalAmount;
        } else {
            vestedAmount = (schedule.totalAmount * (block.timestamp - schedule.startTime)) / schedule.duration;
        }

        return vestedAmount - schedule.releasedAmount;
    }

    /// @notice Returns the aggregate releasable amount across all schedules for a beneficiary.
    function getReleasableAmount(address beneficiary) external view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        uint256 total = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            total += _getReleasableAmountForSchedule(schedules[i]);
        }
        return total;
    }

    /// @notice Returns the releasable amount for a specific schedule.
    function getReleasableAmount(address beneficiary, uint256 scheduleIndex) external view returns (uint256) {
        VestingSchedule[] storage schedules = _vestingSchedules[beneficiary];
        if (scheduleIndex >= schedules.length) revert InvalidScheduleIndex();
        return _getReleasableAmountForSchedule(schedules[scheduleIndex]);
    }

    // Utilities
    function reclaimToken(IERC20 token) external onlyOwner {
        if (token == _token) revert TransferFailed();

        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(owner(), balance);
        emit TokenReclaimed(address(token), owner(), balance);
    }

    function reclaimBNB() external onlyOwner {
        (bool success,) = owner().call{value: address(this).balance}("");
        if (!success) revert TransferFailed();
        emit BNBReclaimed(owner(), address(this).balance);
    }

    /**
     * @dev This function is called for plain Ether transfers, i.e. for every call with empty calldata.
     */
    receive() external payable {}

    /**
     * @dev Fallback function is executed if none of the other functions match the function
     * identifier or no data was provided with the function call.
     */
    fallback() external payable {}
}
