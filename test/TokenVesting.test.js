const {expect} = require("chai");
const {ethers} = require("hardhat");
const {time} = require("@nomicfoundation/hardhat-network-helpers");

describe("CryptoSnackVesting", function() {
    let Token;
    let token;
    let Vesting;
    let vesting;
    let owner;
    let beneficiary;
    let addr2;

    const INITIAL_SUPPLY = 1000000;
    const VESTING_AMOUNT = ethers.parseEther("1000");
    const SELLING_TAX = 500; // 5%
    const BUYING_TAX = 500; // 5%

    beforeEach(async function() {
        // Get signers
        [owner, beneficiary, addr2] = await ethers.getSigners();

        // Deploy CryptoSnackToken
        Token = await ethers.getContractFactory("CryptoSnackToken");
        token = await Token.deploy(
            "CryptoSnack Token",
            "SNACK",
            INITIAL_SUPPLY,
            SELLING_TAX,
            BUYING_TAX,
            owner.address
        );

        // Deploy vesting contract
        Vesting = await ethers.getContractFactory("CryptoSnackVesting");
        vesting = await Vesting.deploy(await token.getAddress());

        // Disable taxes for testing purposes
        await token.setTaxEnabled(false);

        // Transfer tokens to vesting contract (enough for multiple schedules)
        await token.transfer(await vesting.getAddress(), VESTING_AMOUNT * BigInt(10));
    });

    describe("Deployment", function() {
        it("Should set the right token", async function() {
            expect(await vesting.getToken()).to.equal(await token.getAddress());
        });

        it("Should set the right owner", async function() {
            expect(await vesting.owner()).to.equal(owner.address);
        });

        it("Should have correct token balance", async function() {
            expect(await token.balanceOf(await vesting.getAddress())).to.equal(VESTING_AMOUNT * BigInt(10));
        });
    });

    describe("Creating vesting schedule", function() {
        it("Should create vesting schedule correctly", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600; // 1 hour from now
            const cliffDuration = 7200; // 2 hours
            const vestingDuration = 14400; // 4 hours

            await vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                startTime,
                cliffDuration,
                vestingDuration,
                true
            );

            const schedules = await vesting.getVestingSchedules(beneficiary.address);
            expect(schedules.length).to.equal(1);
            const schedule = schedules[0];
            expect(schedule.totalAmount).to.equal(VESTING_AMOUNT);
            expect(schedule.startTime).to.equal(startTime);
            expect(schedule.cliff).to.equal(startTime + cliffDuration);
            expect(schedule.duration).to.equal(vestingDuration);
            expect(schedule.revocable).to.equal(true);
            expect(schedule.revoked).to.equal(false);
        });

        it("Should emit VestingScheduleCreated with scheduleIndex", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;
            const cliffDuration = 7200;
            const vestingDuration = 14400;

            await expect(vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                startTime,
                cliffDuration,
                vestingDuration,
                true
            )).to.emit(vesting, "VestingScheduleCreated").withArgs(
                beneficiary.address,
                0,
                VESTING_AMOUNT,
                startTime,
                startTime + cliffDuration,
                vestingDuration
            );
        });

        it("Should allow creating multiple schedules for the same beneficiary", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;

            await vesting.createVestingSchedule(
                beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, true
            );
            await vesting.createVestingSchedule(
                beneficiary.address, VESTING_AMOUNT, startTime, 3600, 7200, false
            );

            const schedules = await vesting.getVestingSchedules(beneficiary.address);
            expect(schedules.length).to.equal(2);
            expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(2);
        });

        it("Second schedule emits correct index", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;

            await vesting.createVestingSchedule(
                beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, true
            );
            await expect(vesting.createVestingSchedule(
                beneficiary.address, VESTING_AMOUNT, startTime, 3600, 7200, false
            )).to.emit(vesting, "VestingScheduleCreated").withArgs(
                beneficiary.address, 1, VESTING_AMOUNT, startTime, startTime + 3600, 7200
            );
        });

        it("Should revert when beneficiary is zero address", async function() {
            const currentTime = await time.latest();
            await expect(vesting.createVestingSchedule(
                ethers.ZeroAddress,
                VESTING_AMOUNT,
                currentTime + 3600,
                7200,
                14400,
                true
            )).to.be.revertedWithCustomError(vesting, "InvalidBeneficiary");
        });

        it("Should revert when amount is zero", async function() {
            const currentTime = await time.latest();
            await expect(vesting.createVestingSchedule(
                beneficiary.address,
                0,
                currentTime + 3600,
                7200,
                14400,
                true
            )).to.be.revertedWithCustomError(vesting, "InvalidVestingParameters");
        });

        it("Should revert when start time is in the past", async function() {
            const currentTime = await time.latest();
            await expect(vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                currentTime - 3600,
                7200,
                14400,
                true
            )).to.be.revertedWithCustomError(vesting, "InvalidVestingParameters");
        });

        it("Should revert when cliff duration is longer than vesting duration", async function() {
            const currentTime = await time.latest();
            await expect(vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                currentTime + 3600,
                14400,
                7200, // shorter than cliff
                true
            )).to.be.revertedWithCustomError(vesting, "InvalidVestingParameters");
        });
    });

    describe("getVestingScheduleCount", function() {
        it("Returns 0 for address with no schedules", async function() {
            expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(0);
        });

        it("Returns correct count after creation", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;
            await vesting.createVestingSchedule(
                beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, true
            );
            expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(1);
        });
    });

    describe("Token Release", function() {
        describe("Basic release functionality", function() {
            beforeEach(async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;
                await vesting.createVestingSchedule(
                    beneficiary.address,
                    VESTING_AMOUNT,
                    startTime,
                    7200, // 2 hour cliff
                    14400, // 4 hour vesting
                    true
                );
            });

            it("Should not release tokens before cliff", async function() {
                await expect(vesting.connect(beneficiary).release())
                    .to.be.revertedWithCustomError(vesting, "NothingToRelease");
            });

            it("Should release tokens after cliff", async function() {
                await time.increase(10800); // 3 hours (past cliff)

                await vesting.connect(beneficiary).release();

                // After full release when all tokens claimed, schedule is deleted
                expect(await token.balanceOf(beneficiary.address)).to.be.gt(0);
            });

            it("Should fail release if beneficiary gets blacklisted", async function() {
                await time.increase(10800); // 3 hours (past cliff)
                await token.setBlacklist(beneficiary.address, true);

                await expect(vesting.connect(beneficiary).release())
                    .to.be.revertedWithCustomError(token, "BlacklistedAccount");
            });
        });

        describe("Full vesting completion and auto-delete", function() {
            it("Should release full amount after vesting duration and delete schedule", async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;

                await vesting.createVestingSchedule(
                    addr2.address,
                    VESTING_AMOUNT,
                    startTime,
                    7200,
                    14400,
                    true
                );

                await time.increase(20000); // Past vesting duration
                await vesting.connect(addr2).release();

                // Schedule should be auto-deleted after full release
                const schedules = await vesting.getVestingSchedules(addr2.address);
                expect(schedules.length).to.equal(0);
                expect(await token.balanceOf(addr2.address)).to.equal(VESTING_AMOUNT);
            });
        });

        describe("Multi-schedule release", function() {
            it("Should release across all schedules in a single call", async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;

                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, true
                );
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 3600, 14400, false
                );

                await time.increase(20000); // Past both vesting durations

                const balanceBefore = await token.balanceOf(beneficiary.address);
                await vesting.connect(beneficiary).release();
                const balanceAfter = await token.balanceOf(beneficiary.address);

                expect(balanceAfter - balanceBefore).to.equal(VESTING_AMOUNT * BigInt(2));
                // Both schedules fully released, should be auto-deleted
                expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(0);
            });

            it("Should only release from schedules past cliff", async function() {
                const currentTime = await time.latest();
                // Schedule 1: cliff at +3600+7200 = +10800 from now
                // Schedule 2: cliff at +3600+3600 = +7200 from now
                const startTime = currentTime + 3600;

                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, true
                );
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 3600, 14400, false
                );

                // Advance only past schedule 2 cliff but not schedule 1 cliff
                await time.increase(9000); // +9000s: past cliff2 (7200) but not cliff1 (10800)

                await vesting.connect(beneficiary).release();

                const balanceAfter = await token.balanceOf(beneficiary.address);
                expect(balanceAfter).to.be.gt(0);
                // Schedule 1 not yet releasable (before its cliff), schedule 2 partially releasable
                expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(2);
            });

            it("Should revert if no tokens releasable across all schedules", async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 7200;

                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 3600, 7200, true
                );
                // Before cliff
                await expect(vesting.connect(beneficiary).release())
                    .to.be.revertedWithCustomError(vesting, "NothingToRelease");
            });
        });

        it("Should revert release for non-existent schedule", async function() {
            await expect(vesting.connect(addr2).release())
                .to.be.revertedWithCustomError(vesting, "NoVestingSchedule");
        });
    });

    describe("Revocation", function() {
        describe("revokeSchedule", function() {
            beforeEach(async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;
                await vesting.createVestingSchedule(
                    beneficiary.address,
                    VESTING_AMOUNT,
                    startTime,
                    7200,
                    14400,
                    true
                );
            });

            it("Should revoke specific schedule and transfer tokens correctly", async function() {
                await time.increase(10800); // 3 hours (past cliff)

                const ownerBalanceBefore = await token.balanceOf(owner.address);
                await vesting.revokeSchedule(beneficiary.address, 0);

                // Schedule should be removed
                expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(0);

                const ownerBalanceAfter = await token.balanceOf(owner.address);
                expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
                expect(await token.balanceOf(beneficiary.address)).to.be.gt(0);
            });

            it("Should revert revokeSchedule with invalid index", async function() {
                await expect(vesting.revokeSchedule(beneficiary.address, 5))
                    .to.be.revertedWithCustomError(vesting, "InvalidScheduleIndex");
            });

            it("Should not revoke non-revocable schedule", async function() {
                const currentTime = await time.latest();
                await vesting.createVestingSchedule(
                    addr2.address,
                    VESTING_AMOUNT,
                    currentTime + 3600,
                    7200,
                    14400,
                    false // non-revocable
                );

                await expect(vesting.revokeSchedule(addr2.address, 0))
                    .to.be.revertedWithCustomError(vesting, "NotRevocable");
            });

            it("Should emit VestingRevoked and TokensRefunded events", async function() {
                await time.increase(10800);
                await expect(vesting.revokeSchedule(beneficiary.address, 0))
                    .to.emit(vesting, "VestingRevoked").withArgs(beneficiary.address, 0)
                    .and.to.emit(vesting, "TokensRefunded");
            });

            it("Should correctly revoke second schedule by index", async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 3600, 7200, true
                );

                // Now has 2 schedules (index 0 and 1)
                await time.increase(10800);

                // Revoke index 1
                await vesting.revokeSchedule(beneficiary.address, 1);
                expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(1);
            });
        });

        describe("revokeAll", function() {
            it("Should revoke all revocable schedules", async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, true
                );
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 3600, 7200, true
                );

                await time.increase(10800);

                const ownerBalanceBefore = await token.balanceOf(owner.address);
                await vesting.revokeAll(beneficiary.address);

                expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(0);
                const ownerBalanceAfter = await token.balanceOf(owner.address);
                expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
            });

            it("Should skip non-revocable schedules when using revokeAll", async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, true
                );
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 3600, 7200, false // non-revocable
                );

                await time.increase(10800);
                await vesting.revokeAll(beneficiary.address);

                // Non-revocable schedule should remain
                expect(await vesting.getVestingScheduleCount(beneficiary.address)).to.equal(1);
                const remaining = await vesting.getVestingSchedules(beneficiary.address);
                expect(remaining[0].revocable).to.equal(false);
            });

            it("Should revert NoRevocableSchedules when all schedules are non-revocable", async function() {
                const currentTime = await time.latest();
                const startTime = currentTime + 3600;
                await vesting.createVestingSchedule(
                    beneficiary.address, VESTING_AMOUNT, startTime, 7200, 14400, false
                );

                await expect(vesting.revokeAll(beneficiary.address))
                    .to.be.revertedWithCustomError(vesting, "NoRevocableSchedules");
            });

            it("Should revert NoVestingSchedule when no schedules exist", async function() {
                await expect(vesting.revokeAll(addr2.address))
                    .to.be.revertedWithCustomError(vesting, "NoVestingSchedule");
            });
        });
    });

    describe("Utility Functions", function() {
        it("Should allow owner to reclaim other tokens", async function() {
            const OtherToken = await ethers.getContractFactory("CryptoSnackToken");
            const otherToken = await OtherToken.deploy(
                "Other Token",
                "OTHER",
                INITIAL_SUPPLY,
                SELLING_TAX,
                BUYING_TAX,
                owner.address
            );

            await otherToken.transfer(vesting.getAddress(), VESTING_AMOUNT);
            await vesting.reclaimToken(await otherToken.getAddress());

            expect(await otherToken.balanceOf(owner.address)).to.equal(ethers.parseEther(INITIAL_SUPPLY.toString()));
        });

        it("Should not allow reclaiming vesting token", async function() {
            await expect(vesting.reclaimToken(await token.getAddress()))
                .to.be.revertedWithCustomError(vesting, "TransferFailed");
        });

        it("Should allow owner to reclaim BNB", async function() {
            const amount = ethers.parseEther("1.0");
            await owner.sendTransaction({
                to: vesting.getAddress(),
                value: amount
            });

            const balanceBefore = await ethers.provider.getBalance(owner.address);
            await vesting.reclaimBNB();
            const balanceAfter = await ethers.provider.getBalance(owner.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });
    });

    describe("getReleasableAmount", function() {
        it("Should return correct aggregate releasable amount at different times", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;
            await vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                startTime,
                7200,
                14400,
                true
            );

            // Before cliff
            expect(await vesting["getReleasableAmount(address)"](beneficiary.address)).to.equal(0);

            // Middle of vesting
            await time.increaseTo(startTime + 10800); // 75% through vesting
            const midAmount = await vesting["getReleasableAmount(address)"](beneficiary.address);
            expect(midAmount).to.be.gt(0);
            expect(midAmount).to.be.lt(VESTING_AMOUNT);

            // After vesting
            await time.increaseTo(startTime + 14400);
            expect(await vesting["getReleasableAmount(address)"](beneficiary.address)).to.equal(VESTING_AMOUNT);
        });

        it("Should return correct per-schedule releasable amount", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;
            await vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                startTime,
                7200,
                14400,
                true
            );
            await vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                startTime,
                3600,
                14400,
                true
            );

            await time.increaseTo(startTime + 9000);

            // Schedule 0 cliff is at startTime+7200; schedule 1 cliff at startTime+3600
            const s0 = await vesting["getReleasableAmount(address,uint256)"](beneficiary.address, 0);
            const s1 = await vesting["getReleasableAmount(address,uint256)"](beneficiary.address, 1);
            expect(s0).to.be.gt(0); // past its cliff
            expect(s1).to.be.gt(0); // also past its cliff

            const aggregate = await vesting["getReleasableAmount(address)"](beneficiary.address);
            expect(aggregate).to.equal(s0 + s1);
        });

        it("Should revert per-schedule query with invalid index", async function() {
            await expect(vesting["getReleasableAmount(address,uint256)"](beneficiary.address, 0))
                .to.be.revertedWithCustomError(vesting, "InvalidScheduleIndex");
        });
    });

    describe("Total Allocation Tracking", function() {
        beforeEach(async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;

            await vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                startTime,
                7200, // 2 hour cliff
                14400, // 4 hour vesting
                true
            );
        });

        it("Should track initial allocation correctly", async function() {
            expect(await vesting.getTotalAllocated()).to.equal(VESTING_AMOUNT);
        });

        it("Should update allocation after partial release", async function() {
            await time.increase(10800); // 3 hours (past cliff)

            const totalBefore = await vesting.getTotalAllocated();
            await vesting.connect(beneficiary).release();
            const totalAfter = await vesting.getTotalAllocated();

            expect(totalAfter).to.be.lt(totalBefore);
            expect(totalAfter).to.be.gt(0);
        });

        it("Should update allocation after full vesting completion", async function() {
            await time.increase(20000); // Past full vesting duration

            await vesting.connect(beneficiary).release();
            const totalAfter = await vesting.getTotalAllocated();

            expect(totalAfter).to.equal(0);
        });

        it("Should update allocation correctly after revocation", async function() {
            await time.increase(10800); // 3 hours (past cliff)

            await vesting.revokeAll(beneficiary.address);
            const totalAfter = await vesting.getTotalAllocated();

            expect(totalAfter).to.equal(0);
        });

        it("Should track multiple schedules correctly", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;

            await vesting.createVestingSchedule(
                addr2.address,
                VESTING_AMOUNT,
                startTime,
                7200,
                14400,
                true
            );

            expect(await vesting.getTotalAllocated()).to.equal(VESTING_AMOUNT * BigInt(2));

            await time.increase(20000);
            await vesting.connect(beneficiary).release();

            expect(await vesting.getTotalAllocated()).to.equal(VESTING_AMOUNT);

            await vesting.connect(addr2).release();

            expect(await vesting.getTotalAllocated()).to.equal(0);
        });

        it("Should handle allocation correctly with two schedules for same beneficiary", async function() {
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;

            await vesting.createVestingSchedule(
                beneficiary.address,
                VESTING_AMOUNT,
                startTime,
                3600,
                7200,
                true
            );

            expect(await vesting.getTotalAllocated()).to.equal(VESTING_AMOUNT * BigInt(2));

            await time.increase(20000);
            await vesting.connect(beneficiary).release();

            expect(await vesting.getTotalAllocated()).to.equal(0);
        });
    });
});
