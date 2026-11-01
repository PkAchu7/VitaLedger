const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VitaLedger", () => {
  let c, admin, hosp, doc, pat, pharm, other;
  const KEY = ethers.id("key");

  beforeEach(async () => {
    [admin, hosp, doc, pat, pharm, other] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("VitaLedger")).deploy();
    await c.connect(pat).registerPatient(KEY);
    await c.connect(hosp).applyHospital(KEY);
    await c.connect(admin).approve(hosp.address);
    await c.connect(doc).applyDoctor(hosp.address, KEY);
    await c.connect(hosp).approve(doc.address);
    await c.connect(pharm).applyPharmacy(KEY);
    await c.connect(hosp).approve(pharm.address);
  });

  const grant = async () => {
    await c.connect(doc).requestAccess(pat.address);
    await c.connect(pat).grantAccess(doc.address, "0x1234");
  };

  it("a doctor is inactive until their hospital approves", async () => {
    await c.connect(other).applyDoctor(hosp.address, KEY);
    await expect(c.connect(other).requestAccess(pat.address)).to.be.revertedWith("not active");
  });

  it("request -> grant -> view -> add record -> revoke", async () => {
    await grant();
    expect(await c.hasAccess(pat.address, doc.address)).to.equal(true);
    expect(await c.connect(doc).getWrappedKey(pat.address)).to.equal("0x1234");
    await c.connect(doc).logView(pat.address);
    await c.connect(doc).addRecord(pat.address, "cid", KEY, "meta");
    expect((await c.getRecords(pat.address)).length).to.equal(1);
    await c.connect(pat).revokeAccess(doc.address);
    await expect(c.connect(doc).logView(pat.address)).to.be.revertedWith("no access");
  });

  it("blocks adding records without access", async () => {
    await expect(c.connect(doc).addRecord(pat.address, "cid", KEY, "m")).to.be.revertedWith("no access");
  });

  it("a prescription can be dispensed only once", async () => {
    await grant();
    await c.connect(doc).issuePrescription(pat.address, KEY);
    await c.connect(pharm).dispense(0);
    await expect(c.connect(pharm).dispense(0)).to.be.revertedWith("already dispensed");
  });

  it("admin suspension overrides the hospital", async () => {
    await c.connect(admin).suspend(doc.address);
    await expect(c.connect(hosp).approve(doc.address)).to.be.revertedWith("locked by admin");
    await c.connect(admin).approve(doc.address);
    expect(await c.isActive(doc.address, 2)).to.equal(true);
  });

  it("break-glass is recorded without needing approval", async () => {
    await expect(c.connect(doc).breakGlass(pat.address)).to.emit(c, "BreakGlassUsed");
  });
});
