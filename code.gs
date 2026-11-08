function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("PersiaJam_V10")
    .setTitle("صندوق قرض‌الحسنه پرشیا جام")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}


function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}




function getApiUserContext_(employeeCode) {
  var code = String(employeeCode || "").trim();
  var systemUsers = {
    "1001": { name: "مدیر صندوق", role: "مدیر صندوق" },
    "1002": { name: "نایب رئیس", role: "نایب رئیس" },
    "1003": { name: "صندوق دار", role: "صندوق دار" },
    "1004": { name: "بازرس", role: "بازرس" },
    "1005": { name: "ناظر کارفرما", role: "ناظر کارفرما" }
  };
  var user = systemUsers[code] || null;
  if (!user) {
    var member = getMemberByCode_(code);
    if (!member || !member.success) return { success: false, message: "کاربر پیدا نشد" };
    user = { name: String(member.data[1] || ""), role: "عضو", memberStatus: String(member.data[3] || "") };
  }
  var extra = getUserExtraPermissions_(code);
  var effective = getEffectivePermissions_(user.role,
    extra && extra.success && extra.found ? extra.permissions : {},
    extra && extra.success && extra.found ? extra.permissionLevels : {});
  if (!effective || !effective.success) return { success: false, message: "محاسبه دسترسی ناموفق بود" };
  return { success: true, user: user, permissions: effective.permissions, permissionLevels: effective.permissionLevels };
}

function getSystemUserByCode_(employeeCode) {
  var code = String(employeeCode || "").trim();
  var users = {
    "1001": { name: "مدیر صندوق", role: "مدیر صندوق" },
    "1002": { name: "نایب رئیس", role: "نایب رئیس" },
    "1003": { name: "صندوق دار", role: "صندوق دار" },
    "1004": { name: "بازرس", role: "بازرس" },
    "1005": { name: "ناظر کارفرما", role: "ناظر کارفرما" }
  };
  return users[code] || null;
}

function getRoleForEmployeeCode_(code) {
  var systemUser = getSystemUserByCode_(code);
  if (systemUser) return systemUser.role;
  var member = getMemberByCode_(code);
  return member && member.success ? "عضو" : null;
}

function hasApiSectionAccess_(employeeCode, section) {
  var ctx = getApiUserContext_(employeeCode);
  return !!(ctx && ctx.success && ctx.permissions && ctx.permissions[section] === true);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonResponse_({ success: false, message: "اطلاعات درخواست دریافت نشد" });
    return jsonResponse_(apiDispatch(JSON.parse(e.postData.contents)));
  } catch (error) {
    return jsonResponse_({ success: false, message: "خطا در پردازش درخواست", error: String(error) });
  }
}

// تنها نقطه ورود قابل فراخوانی از HTML؛ تمام توابع داخلی با پسوند _ خصوصی شده‌اند.
function apiDispatch(data) {
  try {
    data = data || {};
    var action = String(data.action || "").trim();
    var result;
    if (action === "login") {
      result = loginUser_(data.employeeCode, data.password);
    } else if (action === "logout") {
      var logoutCode = getApiSession_(data.token);
      if (logoutCode && logoutCode === String(data.employeeCode || "").trim()) {
        revokeUserSessions_(logoutCode);
        result = { success: true, message: "نشست باطل شد" };
      } else result = { success: false, authorized: false, message: "نشست معتبر نیست" };
    } else {
      var auth = authorizeApiRequest_(data, action);
      if (!auth.success) result = auth;
      else {
        switch (action) {
          case "getDashboardData":
            result = hasApiSectionAccess_(auth.employeeCode, "dashboard") ? getDashboardData_() : { success: false, authorized: false, message: "دسترسی به داشبورد ندارید" };
            break;
          case "getMoneyFlowData":
            result = hasApiSectionAccess_(auth.employeeCode, "moneyFlow") ? getMoneyFlowData_(data.monthNumber) : { success: false, authorized: false, message: "دسترسی به مسیر پول ندارید" };
            break;
          case "getLotteryArchive":
            result = hasApiSectionAccess_(auth.employeeCode, "dashboard") ? getLotteryArchive_() : { success: false, authorized: false, message: "دسترسی به داشبورد ندارید" };
            break;
          case "getProfileAccessLogs":
            result = isManagerCode_(auth.employeeCode) ? getProfileAccessLogs_() : { success: false, authorized: false, message: "فقط مدیر صندوق مجاز به مشاهده گزارش بازدید نمایه‌هاست" };
            break;
          case "getMemberProfile":
            var memberTarget = String(data.targetEmployeeCode || auth.employeeCode).trim();
            var memberAllowed = memberTarget === auth.employeeCode
              ? (hasApiSectionAccess_(auth.employeeCode, "profile") || hasApiSectionAccess_(auth.employeeCode, "members"))
              : hasApiSectionAccess_(auth.employeeCode, "members");
            if (memberAllowed) {
              result = getMemberProfile_(memberTarget);
              // فقط ورود عضو به نمایه شخصی خودش ثبت می‌شود؛ جستجوی مدیر یا سایر نقش‌ها ثبت نمی‌شود.
              if (result && result.success && memberTarget === auth.employeeCode && auth.employeeCode !== "1001") {
                logOwnProfileVisit_(auth.employeeCode, result.profile && result.profile.name);
              }
            } else result = { success: false, authorized: false, message: "دسترسی به نمایه یا جستجوی اعضا ندارید" };
            break;
          case "getLoanByCode":
            result = hasApiSectionAccess_(auth.employeeCode, "loans") ? getLoanByCode_(data.targetEmployeeCode) : { success: false, authorized: false, message: "دسترسی به اطلاعات وام ندارید" };
            break;
          case "changeMyPassword": result = changeMyPassword_(auth.employeeCode, data.oldPassword, data.newPassword); break;
          case "resetEmployeePassword": result = resetEmployeePassword_(data.targetEmployeeCode, auth.employeeCode); break;
          case "issueInitialPasswords": result = issueInitialPasswords_(auth.employeeCode); break;
          case "createRequest": result = createRequest_(auth.employeeCode, data.requestType, data.title, data.description); break;
          case "getMyRequests": result = getMyRequests_(auth.employeeCode); break;
          case "getAllRequestsForManager": result = getAllRequestsForManager_(auth.employeeCode); break;
          case "reviewRequest": result = reviewRequest_(auth.employeeCode, data.requestId, data.decision, data.managerResponse); break;
          case "submitCommitteeOpinion": result = submitCommitteeOpinion_(auth.employeeCode, data.requestId, data.opinion, data.reason); break;
          case "createAnnouncement": result = createAnnouncement_(auth.employeeCode, data.title, data.text); break;
          case "getAnnouncements": result = getAnnouncements_(auth.employeeCode); break;
          case "markAnnouncementRead": result = markAnnouncementRead_(auth.employeeCode, data.announcementId); break;
          case "deleteAnnouncement": result = deleteAnnouncement_(auth.employeeCode, data.announcementId); break;
          case "getUserAccessForManager":
          case "getUserAccess": result = getUserAccessForManager_(data.employeeCode, auth.employeeCode); break;
          case "searchUserAccess": result = searchUserAccessForManager_(data.query || data.employeeCode || "", auth.employeeCode); break;
          case "updateUserPermission": result = updateUserPermission_(data.employeeCode, data.permission, data.value, auth.employeeCode); break;
          case "updateUserPermissions": result = updateUserPermissions_(data.employeeCode, data.permissions, auth.employeeCode); break;
          case "getUserAccessList": result = getUserAccessListForManager_(auth.employeeCode); break;
          default: result = { success: false, message: "عملیات درخواست‌شده معتبر نیست", action: action };
        }
      }
    }
    // google.script.run انتقال Date را پشتیبانی نمی‌کند؛ خروجی را به JSON-safe object تبدیل می‌کنیم.
    return JSON.parse(JSON.stringify(result));
  } catch (error) {
    return { success: false, message: "خطا در پردازش درخواست", error: String(error) };
  }
}

// تست اتصال به Google Sheet
// ==========================================
// Persia Jam Fund V10 - API Test
// ==========================================

function getFundInfo_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const result = {
    success: true,
    fund: "صندوق قرض‌الحسنه پرشیا جام",
    version: "V10",
    spreadsheet: ss.getName(),
    sheets: []
  };

  ss.getSheets().forEach(sheet => {
    result.sheets.push({
      name: sheet.getName(),
      rows: sheet.getLastRow(),
      columns: sheet.getLastColumn()
    });
  });

  console.log(JSON.stringify(result, null, 2));

  return result;
}
function getSheetHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetNames = [
    "لیست اعضا",
    "پرداخت ماهانه",
    "مدیریت وام‌ها",
    "گزارش مالی",
    "قرعه‌کشی و نوبت‌دهی",
    "هزینه‌های اداری"
  ];

  const result = {};

  sheetNames.forEach(name => {
    const sheet = ss.getSheetByName(name);

    if (!sheet) {
      result[name] = {
        error: "Sheet not found"
      };
      return;
    }

    const lastColumn = sheet.getLastColumn();

    if (lastColumn === 0) {
      result[name] = [];
      return;
    }

    const headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getDisplayValues()[0];

    result[name] = headers;
  });

  console.log(JSON.stringify(result, null, 2));

  return result;
}

function inspectSheetStructure_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetNames = [
    "لیست اعضا",
    "پرداخت ماهانه",
    "مدیریت وام‌ها",
    "گزارش مالی",
    "قرعه‌کشی و نوبت‌دهی",
    "هزینه‌های اداری"
  ];

  const result = {};

  sheetNames.forEach(name => {
    const sheet = ss.getSheetByName(name);

    if (!sheet) {
      result[name] = { error: "Sheet not found" };
      return;
    }

    const rowsToCheck = Math.min(sheet.getLastRow(), 15);
    const colsToCheck = sheet.getLastColumn();

    const values = sheet
      .getRange(1, 1, rowsToCheck, colsToCheck)
      .getDisplayValues();

    result[name] = values.map((row, index) => ({
      row: index + 1,
      values: row.filter(value => value !== "")
    }));
  });

  console.log(JSON.stringify(result, null, 2));

  return result;
}
// ==========================================
// Persia Jam Fund V10
// Member API
// ==========================================

function normalizeValue_(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}


// جستجوی عضو با کد پرسنلی
function getMemberByCode_(employeeCode) {
  var code = String(employeeCode == null ? "" : employeeCode).trim();
  if (!code) return { success: false, message: "کد پرسنلی وارد نشده است" };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("لیست اعضا");
  if (!sheet) return { success: false, message: "شیت لیست اعضا پیدا نشد" };
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return { success: false, message: "عضوی با این کد پرسنلی پیدا نشد", employeeCode: code };
  // طبق ساختار فعلی فایل اکسل: ردیف‌های 1 و 2 سربرگ/توضیح و ستون C کد پرسنلی است.
  var codes = sheet.getRange(3, 3, lastRow - 2, 1).getDisplayValues();
  for (var i = 0; i < codes.length; i++) {
    if (String(codes[i][0] || "").trim() === code) {
      var rowNumber = i + 3;
      return { success: true, employeeCode: code, row: rowNumber,
        data: sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getDisplayValues()[0] };
    }
  }
  return { success: false, message: "عضوی با این کد پرسنلی پیدا نشد", employeeCode: code };
}
// ==========================================
// Persia Jam Fund V10
// Standard Member Profile
// ==========================================

function testMemberProfile_() {

  const result = getMemberProfile_("157");

  console.log(JSON.stringify(result, null, 2));

  return result;
}
function inspectMembersColumns_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("لیست اعضا");

  if (!sheet) {
    console.log("Sheet not found");
    return;
  }

  const lastColumn = sheet.getLastColumn();
  const data = sheet
    .getRange(1, 1, 8, lastColumn)
    .getDisplayValues();

  for (let r = 0; r < data.length; r++) {

    console.log("========== ROW " + (r + 1) + " ==========");

    for (let c = 0; c < data[r].length; c++) {

      if (data[r][c] !== "") {
        console.log(
          "Column " + (c + 1) +
          " | " + data[r][c]
        );
      }

    }
  }
}
// ==========================================
// Persia Jam Fund V10
// Standard V10 Member Profile
// ==========================================

function getV10MemberProfile_(employeeCode) {

  const code = normalizeValue_(employeeCode);

  if (!code) {
    return {
      success: false,
      message: "کد پرسنلی وارد نشده است"
    };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("لیست اعضا");

  if (!sheet) {
    return {
      success: false,
      message: "شیت لیست اعضا پیدا نشد"
    };
  }

  const data = sheet.getDataRange().getDisplayValues();

  let member = null;
  let rowNumber = 0;

  // پیدا کردن عضو بر اساس ستون 3 = کد پرسنلی
  for (let r = 2; r < data.length; r++) {

    if (normalizeValue_(data[r][2]) === code) {
      member = data[r];
      rowNumber = r + 1;
      break;
    }
  }

  if (!member) {
    return {
      success: false,
      message: "عضوی با این کد پرسنلی پیدا نشد",
      employeeCode: code
    };
  }

  const loanAmount = toNumber_(member[15]);
  const remainingLoan = toNumber_(member[16]);

  let paidAmount = 0;

  if (loanAmount > 0 && remainingLoan >= 0) {
    paidAmount = loanAmount - remainingLoan;
  }

  let financialStatus = "تسویه";
  let financialAmount = 0;

  if (remainingLoan > 0) {
    financialStatus = "بدهکار";
    financialAmount = remainingLoan;
  }

  return {

    success: true,

    member: {

      row: rowNumber,

      name: normalizeValue_(member[1]),

      employeeCode: code,

      memberStatus: normalizeValue_(member[3]),

      membership: {
        years: toNumber_(member[4]),
        seniorityAmount: toNumber_(member[5]),
        startMonth: normalizeValue_(member[6]),
        membershipMonths: toNumber_(member[8])
      },

      savings: {
        accumulated: toNumber_(member[9])
      },

      guarantee: {
        total: toNumber_(member[10]),
        type: normalizeValue_(member[11]),
        guarantor: normalizeValue_(member[12])
      },

      loan: {
        status: normalizeValue_(member[13]),
        receiveMonth: normalizeValue_(member[7]),
        amount: loanAmount,
        paidInstallments: toNumber_(member[14]),
        paidAmount: paidAmount,
        remainingAmount: remainingLoan
      },

      financialStatus: {
        status: financialStatus,
        amount: financialAmount
      },

      settlement: {
        exitDate: normalizeValue_(member[19]),
        exitMonth: normalizeValue_(member[20]),
        settlementDate: normalizeValue_(member[21]),
        settlementMonth: normalizeValue_(member[22]),
        settlementAmount: normalizeValue_(member[23])
      }
    }
  };
}


// تبدیل اعداد متنی مثل 50,000,000 به عدد
function toNumber_(value) {

  if (value == null || value == "") {
    return 0;
  }

  var cleaned = String(value).replace(/,/g, "");
  cleaned = cleaned.replace(/[^\d.-]/g, "");

  var number = Number(cleaned);

  if (isNaN(number)) {
    return 0;
  }

  return number;
}
// ==========================================
// Persia Jam Fund V10
// Monthly Payment / Installment API
// ==========================================

function getMemberPayments_(employeeCode) {

  const code = normalizeValue_(employeeCode);

  if (!code) {
    return {
      success: false,
      message: "کد پرسنلی وارد نشده است"
    };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("پرداخت ماهانه");

  if (!sheet) {
    return {
      success: false,
      message: "شیت پرداخت ماهانه پیدا نشد"
    };
  }

  const data = sheet.getDataRange().getDisplayValues();

  if (data.length < 4) {
    return {
      success: false,
      message: "اطلاعات پرداخت ماهانه ناقص است"
    };
  }

  // ردیف 2 = نام ماه‌ها
  // ردیف 3 = عنوان ستون‌ها
  // ردیف 4 به بعد = اعضا

  const monthRow = data[1];

  let memberRow = null;

  for (let r = 3; r < data.length; r++) {

    // ستون 3 = کد پرسنلی
    if (normalizeValue_(data[r][2]) === code) {
      memberRow = data[r];
      break;
    }
  }

  if (!memberRow) {
    return {
      success: false,
      message: "برای این کد پرسنلی اطلاعات پرداخت پیدا نشد",
      employeeCode: code
    };
  }

  const payments = [];

  // ماه 1 تا ماه 30
  // هر ماه 3 ستون دارد
  // ستون‌های شروع ماه اول: ستون 4،5،6
  for (let month = 1; month <= 30; month++) {

    const startIndex = 3 + ((month - 1) * 3);

    const amount = normalizeValue_(memberRow[startIndex]);
    const status = normalizeValue_(memberRow[startIndex + 1]);
    const date = normalizeValue_(memberRow[startIndex + 2]);

    const monthName = normalizeValue_(monthRow[startIndex]);

    payments.push({
      monthNumber: month,
      monthName: monthName,
      amount: toNumber_(amount),
      status: status,
      date: date
    });
  }

  return {
    success: true,
    employeeCode: code,
    payments: payments
  };
}


// تست API پرداخت‌ها
function testMemberPayments_() {

  const result = getMemberPayments_("157");

  console.log(JSON.stringify(result, null, 2));

  return result;
}
function inspectFinancialReport_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("گزارش مالی");

  if (!sheet) {
    console.log("Sheet not found");
    return;
  }

  const rows = Math.min(sheet.getLastRow(), 92);
  const cols = sheet.getLastColumn();

  const data = sheet
    .getRange(1, 1, rows, cols)
    .getDisplayValues();

  for (let r = 0; r < data.length; r++) {

    const nonEmpty = [];

    for (let c = 0; c < data[r].length; c++) {

      if (data[r][c] !== "") {
        nonEmpty.push(
          "Column " + (c + 1) + " | " + data[r][c]
        );
      }

    }

    if (nonEmpty.length > 0) {

      console.log(
        "========== ROW " + (r + 1) + " =========="
      );

      nonEmpty.forEach(function(item) {
        console.log(item);
      });

    }
  }
}
function getPaidInstallmentsSummary_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("پرداخت ماهانه");

  if (!sheet) {
    return {
      success: false,
      message: "Sheet پرداخت ماهانه پیدا نشد"
    };
  }

  const data = sheet.getDataRange().getDisplayValues();

  let totalPaid = 0;
  let paidInstallments = 0;
  let memberCount = 0;

  // داده اعضا از ردیف 4 شروع می‌شود
  for (let r = 3; r < data.length; r++) {

    let memberHasInstallment = false;

    // ساختار هر ماه: مبلغ، وضعیت، تاریخ
    // ماه‌ها از ستون 4 شروع می‌شوند
    for (let c = 3; c < data[r].length; c += 3) {

      const amount = data[r][c];
      const status = data[r][c + 1] || "";

      if (!amount) continue;

      const cleaned = String(amount)
        .replace(/,/g, "")
        .replace(/[^\d.-]/g, "");

      const number = Number(cleaned);

      if (isNaN(number) || number <= 0) continue;

      // فقط پرداخت‌هایی که صراحتاً به عنوان پرداخت‌شده ثبت شده‌اند
      if (String(status).trim() === "پرداخت شده") {

        totalPaid += number;
        paidInstallments++;
        memberHasInstallment = true;
      }
    }

    if (memberHasInstallment) {
      memberCount++;
    }
  }

  return {
    success: true,
    paidInstallmentsCount: paidInstallments,
    paidInstallmentsAmount: totalPaid,
    membersWithPaidInstallments: memberCount
  };
}
function testPaidInstallmentsSummary_() {

  const result = getPaidInstallmentsSummary_();

  console.log(JSON.stringify(result, null, 2));
}
function diagnoseInstallments_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("لیست اعضا");

  const data = sheet.getDataRange().getDisplayValues();

  let totalPaidInstallments = 0;
  let membersWithLoan = 0;

  const samples = [];

  for (let r = 2; r < data.length; r++) {

    const name = data[r][1] || "";
    const code = data[r][2] || "";
    const loanStatus = data[r][13] || "";

    const paidInstallments = toNumber_(data[r][14]);
    const loanAmount = toNumber_(data[r][15]);
    const remainingLoan = toNumber_(data[r][16]);

    if (loanAmount > 0) {

      membersWithLoan++;
      totalPaidInstallments += paidInstallments;

      if (samples.length < 15) {
        samples.push({
          name: name,
          employeeCode: code,
          loanStatus: loanStatus,
          paidInstallments: paidInstallments,
          loanAmount: loanAmount,
          remainingLoan: remainingLoan
        });
      }
    }
  }

  return {
    success: true,
    membersWithLoan: membersWithLoan,
    totalPaidInstallments: totalPaidInstallments,
    samples: samples
  };
}
function testDiagnoseInstallments_() {

  const result = diagnoseInstallments_();

  console.log(JSON.stringify(result, null, 2));
}
function inspectLoanManagement_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("مدیریت وام‌ها");

  if (!sheet) {
    return {
      success: false,
      message: "Sheet مدیریت وام‌ها پیدا نشد"
    };
  }

  const data = sheet.getDataRange().getDisplayValues();

  return {
    success: true,
    rows: sheet.getLastRow(),
    columns: sheet.getLastColumn(),
    firstRows: data.slice(0, 10)
  };
}
function testInspectLoanManagement_() {

  const result = inspectLoanManagement_();

  console.log(JSON.stringify(result, null, 2));
}
function getDashboardData_() {
  // Cache کوتاه‌مدت برای جلوگیری از خواندن چندباره شیت‌ها هنگام جابه‌جایی سریع بین صفحات.
  // زمان اعتبار کوتاه است تا تغییرات مالی با تأخیر طولانی نمایش داده نشوند.
  var cache = CacheService.getScriptCache();
  var cacheKey = "PJ10_DASHBOARD_CACHE_V5";
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (cacheError) { cache.remove(cacheKey); }
  }
  var result = buildDashboardData_();
  if (result && result.success) {
    try {
      var serialized = JSON.stringify(result);
      if (serialized.length < 90000) cache.put(cacheKey, serialized, 60);
    } catch (cacheWriteError) {}
  }
  return result;
}

function buildDashboardData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const membersSheet = ss.getSheetByName("لیست اعضا");
  const loansSheet = ss.getSheetByName("مدیریت وام‌ها");
  const financialSheet = ss.getSheetByName("گزارش مالی");
  const lotterySheet = ss.getSheetByName("قرعه‌کشی و نوبت‌دهی");
  if (!membersSheet || !loansSheet || !financialSheet) return { success:false, message:"یکی از شیت‌های لیست اعضا، مدیریت وام‌ها یا گزارش مالی پیدا نشد" };

  const memberLastRow = membersSheet.getLastRow();
  const loanLastRow = loansSheet.getLastRow();
  // ستون‌های موردنیاز: A:U برای عضویت/خروج و A:L برای وام‌ها.
  const membersData = memberLastRow ? membersSheet.getRange(1, 1, memberLastRow, 25).getDisplayValues() : [];
  const loansData = loanLastRow ? loansSheet.getRange(1, 1, loanLastRow, 13).getDisplayValues() : [];
  const financialRows = Math.min(92, financialSheet.getLastRow());
  if (financialRows < 2) return { success:false, message:"گزارش مالی هنوز داده کافی ندارد" };
  const financialData = financialSheet.getRange(1,1,financialRows,Math.max(7,financialSheet.getLastColumn())).getDisplayValues();
  function num(v){ if(v==null||v==="")return 0; const normalized=String(v).replace(/[۰-۹]/g,function(d){return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d));}).replace(/[٠-٩]/g,function(d){return String("٠١٢٣٤٥٦٧٨٩".indexOf(d));}); const n=Number(normalized.replace(/,/g,"").replace(/[^\d.-]/g,"")); return Number.isFinite(n)?n:0; }
  function fv(row,col){return financialData[row-1] && financialData[row-1][col-1] || "";}
  function fn(row,col){return num(fv(row,col));}
  let totalMembers=0, settledMembers=0;
  for(let r=2;r<membersData.length;r++){
    const code=membersData[r][2]; if(!code)continue; totalMembers++;
    const status=String(membersData[r][3]||"").trim().replace(/[\u200c\s-]/g,'');
    if(status==="تسویهشده") settledMembers++;
  }
  let totalLoans=0,totalLoanAmount=0,activeLoans=0,outstandingLoanAmount=0,paidInstallmentsCount=0,returnedInstallmentAmount=0,remainingInstallmentsCount=0;
  for(let r=2;r<loansData.length;r++){
    if(!loansData[r][2])continue;
    const status=String(loansData[r][3]||"").trim();
    const loanAmount=num(loansData[r][6]), installmentAmount=num(loansData[r][8]), paidInstallments=num(loansData[r][9]), remainingDebt=num(loansData[r][11]);
    if(loanAmount>0){totalLoans++;totalLoanAmount+=loanAmount;paidInstallmentsCount+=paidInstallments;returnedInstallmentAmount+=installmentAmount*paidInstallments;}
    if(loanAmount>0 && status==="فعال"){activeLoans++;outstandingLoanAmount+=remainingDebt;remainingInstallmentsCount+=num(loansData[r][10]);}
  }
  const currentMonthNumber=fn(2,2), trendRow=49+currentMonthNumber;
  // ماه شروع عضویت در ستون G (اندیس ۶)، ماه خروج در U (اندیس ۲۰)
  // و ماه تسویه نهایی در Y (اندیس ۲۴) ثبت می‌شود.
  const memberCountsByMonth = {};
  for (let r=2; r<membersData.length; r++) {
    const row = membersData[r];
    if (!String(row[2] || "").trim()) continue;
    const startMonth = num(row[6]);
    const exitMonth = num(row[20]);
    const settlementMonth = num(row[24]);
    const status = String(row[3] || "").replace(/[\u200c\s-]/g, "");
    if (startMonth > 0) {
      if (!memberCountsByMonth[startMonth]) memberCountsByMonth[startMonth] = { joined:0, exited:0, settled:0 };
      memberCountsByMonth[startMonth].joined++;
    }
    if (exitMonth > 0 && status.indexOf("غیرفعال") >= 0) {
      if (!memberCountsByMonth[exitMonth]) memberCountsByMonth[exitMonth] = { joined:0, exited:0, settled:0 };
      memberCountsByMonth[exitMonth].exited++;
    }
    if (settlementMonth > 0) {
      if (!memberCountsByMonth[settlementMonth]) memberCountsByMonth[settlementMonth] = { joined:0, exited:0, settled:0 };
      memberCountsByMonth[settlementMonth].settled++;
    }
  }
  // شمارش تعداد وام‌های واقعاً پرداخت‌شده بر اساس تاریخ دریافت در شیت «مدیریت وام‌ها».
  // شماره ماه‌ها از خرداد ۱۴۰۵ (ماه ۱) آغاز می‌شود؛ این همان مبنای گزارش مالی است.
  const persianMonthNames = {"فروردین":1,"اردیبهشت":2,"خرداد":3,"تیر":4,"مرداد":5,"شهریور":6,"مهر":7,"آبان":8,"آذر":9,"دی":10,"بهمن":11,"اسفند":12};
  function loanMonthNumber_(dateValue) {
    let value = String(dateValue || "").trim();
    if (!value) return 0;
    value = value.replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    let m = value.match(/(13\d{2}|14\d{2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*\d{1,2}/);
    if (m) { const year = Number(m[1]), month = Number(m[2]); return month >= 1 && month <= 12 ? (year - 1405) * 12 + month - 2 : 0; }
    m = value.match(/(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(13\d{2}|14\d{2})?/);
    if (m) { const year = Number(m[2] || 1405), month = persianMonthNames[m[1]]; return (year - 1405) * 12 + month - 2; }
    return 0;
  }
  const loanCountsByMonth = {};
  for (let r = 2; r < loansData.length; r++) {
    const row = loansData[r];
    const employeeCode = String(row[2] || "").trim();
    const loanAmount = num(row[6]);
    const receivedDate = String(row[5] || "").trim();
    if (!employeeCode || loanAmount <= 0 || !receivedDate) continue;
    const monthNumber = loanMonthNumber_(receivedDate);
    if (monthNumber > 0) loanCountsByMonth[monthNumber] = (loanCountsByMonth[monthNumber] || 0) + 1;
  }
  const monthlyTrend=[];
  for(let row=50;row<=79;row++){
    const month=fv(row,1); if(!month)continue;
    const monthNumber = row - 49;
    const memberCounts = memberCountsByMonth[monthNumber] || { joined:0, exited:0, settled:0 };
    monthlyTrend.push({number:monthNumber,month:month,inflow:fn(row,2),loanPayout:fn(row,3),net:fn(row,4),cumulativeBalance:fn(row,5),settlement:fn(row,6),manualInflow:fn(row,7),loanCount:loanCountsByMonth[monthNumber] || 0,membersNew:memberCounts.joined,membersExited:memberCounts.exited,membersSettled:memberCounts.settled});
  }
  // آمار انتظار تسویه مستقیماً از ردیف‌های اختصاصی گزارش مالی خوانده می‌شود.
  const awaitingSettlementMembers=fn(90,2), awaitingSettlementAmount=fn(91,2), totalSettlementsPaid=fn(92,2);
  // فقط برندگان ماه جاری در داشبورد؛ آرشیو هر ماه در صفحه مسیر پول قابل مشاهده است.
  let currentWinners={month:fv(trendRow,1),names:[],emergencyLoan:""};
  const monthlyWinners=[];
  if(lotterySheet){
    const lotteryLast=Math.min(34,lotterySheet.getLastRow());
    if(lotteryLast>=5){
      const lotteryRows=lotterySheet.getRange(5,1,lotteryLast-4,8).getDisplayValues();
      lotteryRows.forEach((vals,i)=>{
        const monthNumber=i+1, month=String(vals[0]||fv(49+monthNumber,1)||"").trim();
        if(!month)return;
        monthlyWinners.push({number:monthNumber,month,names:vals.slice(1,7).map((name,j)=>({rank:j+1,name:String(name||"").trim()})).filter(x=>x.name),emergencyLoan:String(vals[7]||"").trim()});
      });
    }
  }
  const currentFromArchive=monthlyWinners.find(x=>x.number===currentMonthNumber);
  if(currentFromArchive)currentWinners=currentFromArchive;
  // جزئیات آرشیو برندگان از سوابق واقعی اعضا و وام‌ها تکمیل می‌شود.
  const normalizePersonName = value => String(value||"").replace(/[يى]/g,"ی").replace(/ك/g,"ک").replace(/[\s\u200c]+/g,"").replace(/[‌ـ]/g,"").trim();
  const memberByCode = {};
  for (let r=2; r<membersData.length; r++) {
    const code=String(membersData[r][2]||"").trim();
    if(code && !memberByCode[code]) memberByCode[code]={guarantor:String(membersData[r][12]||"").trim()};
  }
  // مرجع اصلی آرشیو، خود شیت مدیریت وام‌هاست: نام وام‌گیرنده در ستون B و کد پرسنلی در ستون C.
  const latestLoanByName = {};
  for (let r=2; r<loansData.length; r++) {
    const borrowerName=normalizePersonName(loansData[r][1]);
    const code=String(loansData[r][2]||"").trim();
    const amount=num(loansData[r][6]);
    if(borrowerName && code && amount>0) latestLoanByName[borrowerName]={employeeCode:code,loanType:String(loansData[r][4]||"").trim(),receivedDate:String(loansData[r][5]||"").trim(),loanAmount:amount};
  }
  monthlyWinners.forEach(monthItem=>{
    const names=(monthItem.names||[]).map(w=>({name:w.name,emergency:false}));
    if(monthItem.emergencyLoan) names.push({name:monthItem.emergencyLoan,emergency:true});
    monthItem.archiveRows=names.map(w=>{
      const loan=latestLoanByName[normalizePersonName(w.name)]||null;
      const member=loan? (memberByCode[loan.employeeCode]||{}):{};
      return {
        month:monthItem.month,
        name:w.name,
        employeeCode:loan?loan.employeeCode:"",
        loanAmount:loan?loan.loanAmount:null,
        loanType:loan?(loan.loanType|| (w.emergency?"وام اضطراری":"—")):(w.emergency?"وام اضطراری":"—"),
        receivedDate:loan?(loan.receivedDate||""):"",
        guarantor:member.guarantor||"",
        paymentStatus:loan?"دریافت‌شده":"در انتظار پرداخت"
      };
    });
  });
  return {
    success:true,
    currentMonth:{number:currentMonthNumber,name:fv(trendRow,1)},
    overview:{totalMembers,totalLoans,totalLoanAmount,liquidity:fn(34,2),settledMembers,awaitingSettlementMembers,awaitingSettlementAmount,totalSettlementsPaid,paidInstallmentsCount,returnedInstallmentAmount,remainingInstallmentsCount,activeLoans,outstandingLoanAmount},
    monthly:{activeMembers:fn(5,2),employeeShare:fn(6,2),employerSupport:fn(7,2),membershipFee:fn(8,2),totalInflow:fn(trendRow,2),loanPayout:fn(trendRow,3),settlement:fn(trendRow,6),manualInflow:fn(trendRow,7),net:fn(trendRow,4),loanCount:loanCountsByMonth[currentMonthNumber] || 0,membersNew:(memberCountsByMonth[currentMonthNumber]||{}).joined||0,membersExited:(memberCountsByMonth[currentMonthNumber]||{}).exited||0,membersSettled:(memberCountsByMonth[currentMonthNumber]||{}).settled||0},
    reserve:{target:fn(39,2),current:fn(40,2),progress:fv(41,2)},
    arrears:{dueMembers:fn(44,2),unpaidMembers:fn(45,2),unpaidAmount:fn(46,2)},
    management:{averageSavingsPerMember:fn(82,2),simultaneousExitCoverage:fn(83,2),employerDependencyPercent:fn(84,2),sustainableLoansPerMonth:fn(85,2),averageMonthlyNet:fn(86,2),monthsToReserveTarget:fn(87,2)},
    monthlyTrend,
    currentWinners,
    monthlyWinners
  };
}
function getLotteryArchive_() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName("قرعه‌کشی و نوبت‌دهی");
  if(!sh || sh.getLastRow()<5)return {success:true,months:[]};
  const last=Math.min(34,sh.getLastRow());
  const rows=sh.getRange(5,1,last-4,8).getDisplayValues();
  const months=rows.map((r,i)=>({number:i+1,month:String(r[0]||"").trim(),names:r.slice(1,7).map((n,j)=>({rank:j+1,name:String(n||"").trim()})).filter(x=>x.name),emergencyLoan:String(r[7]||"").trim()})).filter(x=>x.month);
  return {success:true,months:months.reverse()};
}

function testDashboardData_() {

  const result = getDashboardData_();

  console.log(JSON.stringify(result, null, 2));
}
function getLoanByCode_(employeeCode) {
  var code = String(employeeCode == null ? "" : employeeCode).trim();
  if (!code) return { success: false, found: false, message: "کد پرسنلی معتبر نیست" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var membersSheet = ss.getSheetByName("لیست اعضا");
  var loansSheet = ss.getSheetByName("مدیریت وام‌ها");
  if (!membersSheet || !loansSheet) return { success: false, found: false, message: "شیت اعضا یا مدیریت وام‌ها پیدا نشد" };
  var memberResult = getMemberByCode_(code);
  if (!memberResult.success) return { success: false, found: false, message: memberResult.message };
  var m = memberResult.data;
  var member = {
    name: String(m[1] || ""), employeeCode: code, status: String(m[3] || ""),
    seniorityYears: toNumber_(m[4]), accumulatedGuarantee: toNumber_(m[10]),
    guarantor: String(m[12] || ""), loanStatus: String(m[13] || ""),
    loanAmount: toNumber_(m[15]), remainingLoan: toNumber_(m[16])
  };
  var memberLoanActive = String(m[13] || "").trim() === "فعال";
  if (!memberLoanActive) return { success: true, found: true, hasActiveLoan: false, member: member, message: "وام فعال ندارد" };
  var lastRow = loansSheet.getLastRow();
  if (lastRow < 3) return { success: true, found: true, hasActiveLoan: false, member: member, message: "وام فعال ندارد" };
  var rows = loansSheet.getRange(3, 1, lastRow - 2, loansSheet.getLastColumn()).getDisplayValues();
  var selected = null;
  // از پایین به بالا: در صورت وجود چند رکورد، آخرین وام فعال انتخاب می‌شود.
  for (var i = rows.length - 1; i >= 0; i--) {
    var row = rows[i];
    if (String(row[2] || "").trim() !== code) continue;
    var status = String(row[3] || "").trim();
    var amount = toNumber_(row[6]);
    if (amount > 0 && status === "فعال") { selected = row; break; }
  }
  if (!selected) return { success: true, found: true, hasActiveLoan: false, member: member, message: "وام فعال ندارد" };
  var loan = {
    status: selected[3] || "", loanType: selected[4] || "", receivedDate: selected[5] || "",
    loanAmount: toNumber_(selected[6]), totalInstallments: toNumber_(selected[7]),
    installmentAmount: toNumber_(selected[8]), paidInstallments: toNumber_(selected[9]),
    remainingInstallments: toNumber_(selected[10]), remainingDebt: toNumber_(selected[11]),
    settlementPercent: selected[12] || ""
  };
  return { success: true, found: true, hasActiveLoan: true, member: member, loan: loan };
}function testLoanByCode() {

  const result = getLoanByCode_("157");

  console.log(JSON.stringify(result, null, 2));
}
function getMoneyFlowData_(monthNumber) {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const financialSheet=ss.getSheetByName("گزارش مالی");
  const paymentSheet=ss.getSheetByName("پرداخت ماهانه");
  const lotterySheet=ss.getSheetByName("قرعه‌کشی و نوبت‌دهی");
  const settingsSheet=ss.getSheetByName("تنظیمات");
  const expenseSheet=ss.getSheetByName("هزینه‌های اداری");
  if(!financialSheet)return {success:false,message:"برگه گزارش مالی پیدا نشد"};
  const maxRows=Math.max(92,financialSheet.getLastRow());
  const data=financialSheet.getRange(1,1,Math.min(maxRows,92),Math.max(7,financialSheet.getLastColumn())).getDisplayValues();
  function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/,/g,"").replace(/[^\d.-]/g,""));return Number.isFinite(n)?n:0;}
  function value(row,col){return data[row-1]&&data[row-1][col-1]||"";}
  function number(row,col){return num(value(row,col));}
  const selectedMonth=monthNumber?Number(monthNumber):number(2,2);
  if(!selectedMonth||selectedMonth<1||selectedMonth>30)return {success:false,message:"شماره ماه باید بین 1 تا 30 باشد"};
  const trendRow=49+selectedMonth, monthName=value(trendRow,1);
  if(!monthName)return {success:false,message:"اطلاعات این ماه در گزارش مالی وجود ندارد"};
  const totalInflow=number(trendRow,2),loanPayout=number(trendRow,3),monthlyNet=number(trendRow,4),settlement=number(trendRow,6),manualInflow=number(trendRow,7);
  // ریز سهم‌ها از بلوک همان ماه در پرداخت ماهانه استخراج می‌شود.
  let employeeShare=null,employerSupport=null,membershipFee=null,paidMembers=null,paidAmount=null,breakdownSource="";
  let reconciliationDifference=null;
  if(paymentSheet && paymentSheet.getLastRow()>=4){
    const amountCol=4+3*(selectedMonth-1),statusCol=amountCol+1;
    if(amountCol<=paymentSheet.getLastColumn()){
      const rows=paymentSheet.getRange(4,amountCol,Math.max(0,paymentSheet.getLastRow()-3),2).getDisplayValues();
      paidMembers=0;paidAmount=0;
      rows.forEach(r=>{if(String(r[1]||"").trim()==="پرداخت شده"){paidMembers++;paidAmount+=num(r[0]);}});
      let employeePer=2000000,feePer=200000;
      if(settingsSheet){employeePer=num(settingsSheet.getRange("B5").getDisplayValue())||employeePer;feePer=num(settingsSheet.getRange("B4").getDisplayValue())||feePer;}
      const employerCell=paymentSheet.getRange(99,amountCol).getDisplayValue();
      employerSupport=num(employerCell);
      employeeShare=paidMembers*employeePer;
      membershipFee=paidMembers*feePer;
      reconciliationDifference=totalInflow-(paidAmount+employerSupport);
      breakdownSource="پرداخت ماهانه";
    }
  }
  if(selectedMonth===number(2,2)){
    employeeShare=number(6,2);employerSupport=number(7,2);membershipFee=number(8,2);breakdownSource="گزارش مالی و پرداخت ماهانه";
  }
  let cumulativeInflow=0;for(let row=50;row<=trendRow;row++)cumulativeInflow+=number(row,2);

  // هزینه‌های اداری: ستون‌های B تا E به‌ترتیب تاریخ، شرح، مبلغ و توضیحات‌اند.
  // تاریخ شمسی (با ارقام فارسی یا لاتین) مبنای تخصیص هزینه به ماه است.
  const expenses=[],undatedExpenses=[];
  let administrativeExpenses=0,undatedExpensesTotal=0;
  const monthNames=["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
  const selectedMonthName=String(monthName||"");
  const reportMonthMatch=selectedMonthName.match(/(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/);
  const reportMonthIndex=reportMonthMatch?monthNames.indexOf(reportMonthMatch[1])+1:selectedMonth;
  const reportYearMatch=selectedMonthName.match(/(13|14)\d{2}/);
  const reportYear=reportYearMatch?Number(reportYearMatch[0]):null;
  function latinDigits(v){return String(v||"").replace(/[۰-۹٠-٩]/g,ch=>{const fa="۰۱۲۳۴۵۶۷۸۹",ar="٠١٢٣٤٥٦٧٨٩";let i=fa.indexOf(ch);if(i<0)i=ar.indexOf(ch);return String(i<0?ch:i);});}
  function expenseBelongsToMonth(dateText){
    const raw=String(dateText||"").trim();if(!raw)return null;
    const t=latinDigits(raw).replace(/[\s.-]+/g,"/");
    const named=monthNames.findIndex(m=>raw.indexOf(m)>=0);
    if(named>=0){
      const y=t.match(/(13|14)\d{2}/),dateYear=y?Number(y[0]):null;
      return named+1===reportMonthIndex && (!reportYear || !dateYear || dateYear===reportYear);
    }
    const m=t.match(/(?:^|[^\d])(\d{4})\/(\d{1,2})\/(\d{1,2})(?:$|[^\d])/);
    if(m){const year=Number(m[1]),month=Number(m[2]);return month===reportMonthIndex && (!reportYear || year===reportYear);}
    const short=t.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:$|[^\d])/);
    if(short){const month=Number(short[2]),year=Number(short[3]);return month===reportMonthIndex && (!reportYear || year<100 || year===reportYear || String(reportYear).slice(-2)===String(year));}
    return null;
  }
  if(expenseSheet && expenseSheet.getLastRow()>=3){
    const expRows=expenseSheet.getRange(3,1,expenseSheet.getLastRow()-2,5).getDisplayValues();
    expRows.forEach(r=>{
      const date=String(r[1]||"").trim(),description=String(r[2]||"").trim(),amount=num(latinDigits(r[3])),note=String(r[4]||"").trim();
      if(!description || !amount)return;
      const item={date:date,description:description,amount:amount,note:note};
      const belongs=expenseBelongsToMonth(date);
      if(belongs===true){expenses.push(item);administrativeExpenses+=amount;}
      else if(belongs===null){undatedExpenses.push(item);undatedExpensesTotal+=amount;}
    });
  }
  let winners={month:monthName,names:[],emergencyLoan:""};
  if(lotterySheet && selectedMonth<=30){
    const vals=lotterySheet.getRange(4+selectedMonth,1,1,8).getDisplayValues()[0];
    winners.month=vals[0]||monthName;
    winners.names=vals.slice(1,7).map((name,i)=>({rank:i+1,name:String(name||"").trim()})).filter(x=>x.name);
    winners.emergencyLoan=String(vals[7]||"").trim();
  }
  return {
    success:true,month:{number:selectedMonth,name:monthName},
    inflow:{employeeShare,employerSupport,membershipFee,manualInflow,total:totalInflow,paidMembers,paidAmount,breakdownSource,reconciliationDifference},
    outflow:{loanPayout,settlement,administrativeExpenses,expenses,undatedExpenses,undatedExpensesTotal,total:loanPayout+settlement+administrativeExpenses},
    balance:{net:monthlyNet,netAfterAdministrativeExpenses:monthlyNet-administrativeExpenses,cumulativeInflow},
    settings:{activeMembers:paidMembers,employeeSharePerMember:2000000,employerSharePerMember:2000000,membershipFeePerMember:200000},
    winners
  };
}

// ثبت بازدید عضو از نمایه شخصی خودش؛ فقط کد پرسنلی و زمان ثبت می‌شود.
function logOwnProfileVisit_(employeeCode, employeeName) {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sheetName="گزارش بازدید نمایه";
  let sh=ss.getSheetByName(sheetName);
  if(!sh){sh=ss.insertSheet(sheetName);sh.getRange(1,1,1,3).setValues([["زمان بازدید","کد پرسنلی","نام عضو"]]);sh.setFrozenRows(1);}
  const lock=LockService.getScriptLock();
  try{lock.waitLock(5000);sh.appendRow([new Date(),String(employeeCode||""),String(employeeName||"")]);}
  finally{try{lock.releaseLock();}catch(e){}}
}

// گزارش فقط برای مدیر صندوق قابل دریافت است.
function getProfileAccessLogs_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const sh=ss.getSheetByName("گزارش بازدید نمایه");
  if(!sh||sh.getLastRow()<2)return {success:true,logs:[]};
  const rows=sh.getRange(2,1,sh.getLastRow()-1,3).getDisplayValues();
  return {success:true,logs:rows.slice(-300).reverse().map(r=>({visitedAt:r[0],employeeCode:r[1],name:r[2]}))};
}

function testMoneyFlowData_() {

  const result = getMoneyFlowData_(5);

  console.log(
    JSON.stringify(result, null, 2)
  );
}
function getAnnouncements_(employeeCode) {
  const code = String(employeeCode || "").trim();
  const access = getSectionAccess_(code, "announcements");
  if (!access.success || (access.level !== "view" && access.level !== "manage")) {
    return { success: false, authorized: false, message: "برای مشاهده اعلانات دسترسی ندارید" };
  }

  const sh = getAnnouncementsSheet_();
  const reads = getAnnouncementReadsSheet_();
  const lastRow = sh.getLastRow();
  const rows = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, 6).getValues() : [];
  const readRows = reads.getLastRow() >= 2 ? reads.getRange(2, 1, reads.getLastRow() - 1, 3).getDisplayValues() : [];
  const readSet = {};
  readRows.forEach(function(r) {
    if (String(r[1] || "").trim() === code) readSet[String(r[0] || "").trim()] = true;
  });

  const announcements = rows.filter(function(r) {
    return String(r[0] || "").trim() && String(r[4] || "منتشر شده").trim() === "منتشر شده";
  }).map(function(r) {
    const id = String(r[0]).trim();
    const date = r[3];
    let dateText = "";
    if (date instanceof Date && !isNaN(date.getTime())) dateText = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm");
    else dateText = String(date || "");
    return { id: id, title: String(r[1] || ""), text: String(r[2] || ""), createdAt: date, dateText: dateText, createdBy: String(r[5] || ""), unread: !readSet[id] };
  });
  const unreadCount = announcements.filter(function(x) { return x.unread; }).length;
  return { success: true, authorized: true, level: access.level, count: announcements.length, unreadCount: unreadCount, announcements: announcements };
}

function testAnnouncements_() {

  const result = getAnnouncements_();

  console.log(
    JSON.stringify(result, null, 2)
  );
}
function testCreateAnnouncement_() {

  const result = createAnnouncement_(
    "تست ثبت اطلاعیه",
    "این یک اطلاعیه آزمایشی برای بررسی ثبت از طریق API است.",
    "مدیر صندوق"
  );

  console.log(
    JSON.stringify(result, null, 2)
  );
}
function getUnreadAnnouncementCount_(employeeCode) {
  const result = getAnnouncements_(employeeCode);
  if (!result.success) return result;
  return { success: true, unreadCount: Number(result.unreadCount || 0) };
}

function testUnreadAnnouncementCount_() {

  const result =
    getUnreadAnnouncementCount_("157");

  console.log(
    JSON.stringify(result, null, 2)
  );
}

function markAnnouncementAsRead_(employeeCode, announcementId) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const announcementsSheet =
    ss.getSheetByName("اعلانات");

  const readsSheet =
    ss.getSheetByName("خواندن اعلانات");

  if (!announcementsSheet) {
    return {
      success: false,
      message: "برگه اعلانات پیدا نشد"
    };
  }

  if (!readsSheet) {
    return {
      success: false,
      message: "برگه خواندن اعلانات پیدا نشد"
    };
  }

  const code = String(employeeCode || "").trim();
  const id = String(announcementId || "").trim();

  if (!code) {
    return {
      success: false,
      message: "کد پرسنلی وارد نشده است"
    };
  }

  if (!id) {
    return {
      success: false,
      message: "شناسه اطلاعیه وارد نشده است"
    };
  }

  // بررسی وجود اطلاعیه و منتشر بودن آن
  const announcementsData =
    announcementsSheet
      .getDataRange()
      .getDisplayValues();

  let announcementExists = false;

  for (let r = 1; r < announcementsData.length; r++) {

    const currentId =
      String(announcementsData[r][0] || "").trim();

    const status =
      String(announcementsData[r][4] || "").trim();

    if (
      currentId === id &&
      status === "منتشر شده"
    ) {
      announcementExists = true;
      break;
    }
  }

  if (!announcementExists) {
    return {
      success: false,
      message: "اطلاعیه منتشرشده با این شناسه پیدا نشد"
    };
  }

  // بررسی اینکه قبلاً خوانده نشده باشد
  const readsData =
    readsSheet
      .getDataRange()
      .getDisplayValues();

  for (let r = 1; r < readsData.length; r++) {

    const readAnnouncementId =
      String(readsData[r][0] || "").trim();

    const readEmployeeCode =
      String(readsData[r][1] || "").trim();

    if (
      readAnnouncementId === id &&
      readEmployeeCode === code
    ) {

      return {
        success: true,
        alreadyRead: true,
        message: "این اطلاعیه قبلاً خوانده شده است"
      };
    }
  }

  // ثبت مشاهده
  const readDate =
    Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy/MM/dd HH:mm:ss"
    );

  readsSheet.appendRow([
    id,
    code,
    readDate
  ]);

  return {

    success: true,

    alreadyRead: false,

    employeeCode: code,

    announcementId: id,

    readDate: readDate,

    message: "اطلاعیه به عنوان خوانده‌شده ثبت شد"
  };
}
function testMarkAnnouncementAsRead_() {

  const result =
    markAnnouncementAsRead_("157", "1");

  console.log(
    JSON.stringify(result, null, 2)
  );
}
function getMemberRequests_(employeeCode) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("درخواست ها");

  if (!sheet) {
    return {
      success: false,
      message: "برگه درخواست ها پیدا نشد"
    };
  }

  const code = String(employeeCode || "").trim();

  if (!code) {
    return {
      success: false,
      message: "کد پرسنلی وارد نشده است"
    };
  }

  const data =
    sheet
      .getDataRange()
      .getDisplayValues();

  const requests = [];

  for (let r = 1; r < data.length; r++) {

    const rowCode =
      String(data[r][1] || "").trim();

    if (rowCode !== code) {
      continue;
    }

    requests.push({

      id:
        data[r][0] || "",

      employeeCode:
        data[r][1] || "",

      memberName:
        data[r][2] || "",

      requestType:
        data[r][3] || "",

      description:
        data[r][4] || "",

      requestDate:
        data[r][5] || "",

      status:
        data[r][6] || "",

      managerResponse:
        data[r][7] || "",

      reviewDate:
        data[r][8] || ""
    });
  }

  return {

    success: true,

    employeeCode: code,

    count: requests.length,

    requests: requests
  };
}
function testMemberRequests_() {

  const result =
    getMemberRequests_("157");

  console.log(
    JSON.stringify(result, null, 2)
  );
}

function getPendingRequests_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("درخواست ها");

  if (!sheet) {
    return {
      success: false,
      message: "برگه درخواست ها پیدا نشد"
    };
  }

  const data =
    sheet
      .getDataRange()
      .getDisplayValues();

  const requests = [];

  for (let r = 1; r < data.length; r++) {

    const id =
      String(data[r][0] || "").trim();

    const status =
      String(data[r][6] || "").trim();

    if (!id) {
      continue;
    }

    if (status !== "در انتظار بررسی") {
      continue;
    }

    requests.push({

      id:
        data[r][0] || "",

      employeeCode:
        data[r][1] || "",

      memberName:
        data[r][2] || "",

      requestType:
        data[r][3] || "",

      description:
        data[r][4] || "",

      requestDate:
        data[r][5] || "",

      status:
        status
    });
  }

  return {

    success: true,

    count: requests.length,

    requests: requests
  };
}


function testPendingRequests_() {

  const result =
    getPendingRequests_();

  console.log(
    JSON.stringify(result, null, 2)
  );
}

function reviewRequest_(requesterCode, requestId, decision, managerResponse) {
  const code=String(requesterCode||"").trim(), id=String(requestId||"").trim();
  const result=String(decision||"").trim(), response=String(managerResponse||"").trim();
  if (code !== "1001") return {success:false,authorized:false,message:"تصمیم نهایی فقط توسط مدیر صندوق ثبت می‌شود"};
  if (["تأیید شد","رد شد"].indexOf(result) < 0) return {success:false,message:"تصمیم نهایی باید تأیید یا رد باشد"};
  if (!response) return {success:false,message:"ثبت دلیل تصمیم نهایی الزامی است"};
  if (!id) return {success:false,message:"شناسه درخواست معتبر نیست"};
  const sh=getRequestsSheet_(), last=sh.getLastRow();
  if(last<2)return {success:false,message:"هیچ درخواستی وجود ندارد"};
  const data=sh.getRange(2,1,last-1,17).getValues(); let row=-1;
  for(let i=0;i<data.length;i++) if(String(data[i][0]).trim()===id){row=i+2;break;}
  if(row<0)return {success:false,message:"درخواست پیدا نشد"};
  if(String(sh.getRange(row,8).getValue()).trim()!=="در انتظار بررسی")return {success:false,message:"این درخواست قبلاً تصمیم‌گیری شده است"};
  // تصمیم نهایی مدیر فقط پس از ثبت هر دو نظر مستقل نایب‌رئیس و صندوق‌دار مجاز است.
  const viceOpinion = String(sh.getRange(row,12).getValue() || "").trim();
  const cashierOpinion = String(sh.getRange(row,15).getValue() || "").trim();
  if (!viceOpinion || !cashierOpinion) {
    return {success:false,message:"ثبت نظر مستقل نایب‌رئیس و صندوق‌دار الزامی است؛ تا ثبت هر دو نظر امکان تصمیم نهایی وجود ندارد."};
  }
  // این عملیات صرفاً وضعیت و پاسخ درخواست را ثبت می‌کند و هیچ رکورد مالی/وامی ایجاد نمی‌کند.
  sh.getRange(row,8,1,4).setValues([[result,response,new Date(),code]]);
  return {success:true,authorized:true,requestId:id,status:result,message:"تصمیم نهایی مدیر ثبت شد"};
}

function submitCommitteeOpinion_(requesterCode, requestId, opinion, reason) {
  const code=String(requesterCode||"").trim(), id=String(requestId||"").trim();
  const roleMap={"1002":{role:"vice",cols:[12,13,14]},"1003":{role:"cashier",cols:[15,16,17]}};
  const reviewer=roleMap[code];
  if(!reviewer)return {success:false,authorized:false,message:"ثبت نظر مشورتی فقط برای نایب‌رئیس و صندوق‌دار مجاز است"};
  const sectionAccess=getSectionAccess_(code,"requests");
  if(!sectionAccess.success || !sectionAccess.authorized) return {success:false,authorized:false,message:"دسترسی مشاهده درخواست‌ها برای شما فعال نیست"};
  const choice=String(opinion||"").trim(), note=String(reason||"").trim();
  if(["موافق","مخالف"].indexOf(choice)<0)return {success:false,message:"نظر باید موافق یا مخالف باشد"};
  if(!note)return {success:false,message:"ثبت دلیل نظر الزامی است"};
  if(!id)return {success:false,message:"شناسه درخواست معتبر نیست"};
  const sh=getRequestsSheet_(), last=sh.getLastRow();
  if(last<2)return {success:false,message:"درخواستی وجود ندارد"};
  const data=sh.getRange(2,1,last-1,17).getValues(); let row=-1;
  for(let i=0;i<data.length;i++)if(String(data[i][0]).trim()===id){row=i+2;break;}
  if(row<0)return {success:false,message:"درخواست پیدا نشد"};
  if(String(sh.getRange(row,8).getValue()).trim()!=="در انتظار بررسی")return {success:false,message:"این درخواست بسته شده و امکان ثبت نظر ندارد"};
  const cols=reviewer.cols;
  if(String(sh.getRange(row,cols[0]).getValue()||"").trim())return {success:false,message:"نظر شما قبلاً ثبت شده است"};
  sh.getRange(row,cols[0],1,3).setValues([[choice,note,new Date()]]);
  return {success:true,message:"نظر مشورتی شما ثبت شد"};
}

function testReviewRequestApprove_() {

  const result =
    reviewRequest_(
      "1",
      "تأیید",
      "درخواست مورد تأیید است. مبلغ نهایی پس از ثبت مالی در سیستم اصلی اعمال می‌شود."
    );

  console.log(
    JSON.stringify(result, null, 2)
  );
}


function testCreateRequestForReject_() {

  const result =
    createRequest_(
      "157",
      "سایر درخواست",
      "درخواست آزمایشی برای تست رد شدن"
    );

  console.log(
    JSON.stringify(result, null, 2)
  );
}
function testReviewRequestReject_() {

  const result =
    reviewRequest_(
      "2",
      "رد",
      "این درخواست صرفاً برای تست مسیر رد درخواست ثبت شده است."
    );

  console.log(
    JSON.stringify(result, null, 2)
  );
}





function getUserPermissions_(role) {

  const permissions = {

    "مدیر صندوق": {
      dashboard: true,
      members: true,
      loans: true,
      moneyFlow: true,
      requests: true,
      announcements: true,
      settings: true
    },

    "نایب رئیس": {
      dashboard: true,
      members: true,
      loans: true,
      moneyFlow: true,
      requests: true,
      announcements: false,
      settings: false
    },

    "صندوق دار": {
      dashboard: true,
      members: true,
      loans: true,
      moneyFlow: true,
      requests: true,
      announcements: false,
      settings: false
    },

    "بازرس": {
      dashboard: true,
      members: true,
      loans: false,
      moneyFlow: true,
      requests: false,
      announcements: false,
      settings: false
    },

    "ناظر کارفرما": {
      dashboard: true,
      members: true,
      loans: false,
      moneyFlow: false,
      requests: false,
      announcements: false,
      settings: false
    },

    "عضو": {
      dashboard: false,
      members: false,
      loans: false,
      moneyFlow: false,
      requests: true,
      announcements: true,
      settings: false,
      profile: true
    }

  };

  if (!permissions[role]) {

    return {
      success: false,
      message: "نقش کاربر معتبر نیست"
    };

  }

  return {
    success: true,
    role: role,
    permissions: permissions[role]
  };
}

function testManagerPermissions_() {

  const result =
    getUserPermissions_("مدیر صندوق");

  console.log(
    JSON.stringify(result, null, 2)
  );
}

function testInspectorPermissions_() {

  const result =
    getUserPermissions_("بازرس");

  console.log(
    JSON.stringify(result, null, 2)
  );
}


function getEffectivePermissions_(role, extraPermissions, extraPermissionLevels) {
  const base = getUserPermissions_(role);
  if (!base || !base.success) return { success: false, message: "نقش کاربر معتبر نیست" };

  const permissions = Object.assign({}, base.permissions);
  const levels = { requests: null, announcements: null };
  const extras = extraPermissions || {};
  const extraLevels = extraPermissionLevels || {};
  const manager = role === "مدیر صندوق";

  ["dashboard", "members", "loans", "moneyFlow", "settings", "profile"].forEach(function(key) {
    if (extras[key] === true) permissions[key] = true;
    else if (extras[key] === false) permissions[key] = false;
  });

  if (manager) {
    permissions.requests = true;
    permissions.announcements = true;
    permissions.settings = true;
    levels.requests = "manage";
    levels.announcements = "manage";
  } else {
    // تنظیمات مدیریتی هرگز به نقش‌های غیرمدیر واگذار نمی‌شود.
    permissions.settings = false;
    // درخواست‌ها: عضو عادی فقط فرم و سوابق شخصی خودش را دارد؛
    // مشاهده/مدیریت همه درخواست‌ها فقط با سطح دسترسی صریح فعال می‌شود.
    let requestLevel = extraLevels.requests;
    if (requestLevel !== "view" && requestLevel !== "manage") requestLevel = null;
    if (requestLevel === null && (role === "نایب رئیس" || role === "صندوق دار")) requestLevel = "view";
    if (requestLevel === null && extras.requests === true) requestLevel = "view";
    if (extras.requests === false) requestLevel = null;
    levels.requests = (role === "عضو" && extras.requests == null && extraLevels.requests == null) ? null : requestLevel;
    permissions.requests = role === "عضو" && extras.requests !== false || requestLevel !== null;

    // اعضا به‌صورت پیش‌فرض فقط اطلاعیه‌ها را می‌خوانند.
    let announcementLevel = extraLevels.announcements;
    if (announcementLevel !== "view" && announcementLevel !== "manage") announcementLevel = null;
    if (announcementLevel === null && extras.announcements === true) announcementLevel = "view";
    if (extras.announcements === false) announcementLevel = null;
    if (role === "عضو" && extras.announcements == null && extraLevels.announcements == null) announcementLevel = "view";
    levels.announcements = announcementLevel;
    permissions.announcements = announcementLevel !== null;
  }

  return { success: true, role: role, permissions: permissions, permissionLevels: levels };
}

function testExtraPermission_() {

  const result =
    getEffectivePermissions_(
      "بازرس",
      {
        loans: true
      }
    );

  console.log(
    JSON.stringify(result, null, 2)
  );
}

function getLoanByCodeSecure_(employeeCode, role, extraPermissions) {

  // بررسی دسترسی
  const permissionResult =
  getEffectivePermissions_(
    role,
    extraPermissions,
    extraResult.success && extraResult.found
      ? extraResult.permissionLevels
      : {}
  );

  if (!permissionResult.success) {

    return {
      success: false,
      authorized: false,
      message: "نقش کاربر معتبر نیست"
    };
  }

  if (!permissionResult.permissions.loans) {

    return {
      success: false,
      authorized: false,
      message: "دسترسی به اطلاعات وام برای این کاربر مجاز نیست"
    };
  }

  // اگر دسترسی مجاز بود،
  // از تابع فعلی و تست‌شده استفاده می‌کنیم.
  const result =
    getLoanByCode_(employeeCode);

  result.authorized = true;

  return result;
}

function testSecureLoanInspector_() {

  const result =
    getLoanByCodeSecure_(
      "157",
      "بازرس"
    );

  console.log(
    JSON.stringify(result, null, 2)
  );
}

function testSecureLoanManager_() {

  const result =
    getLoanByCodeSecure_(
      "157",
      "مدیر صندوق"
    );

  console.log(
    JSON.stringify(result, null, 2)
  );
}

function getCurrentUser_(employeeCode, role, extraPermissions) {

  const code = String(employeeCode).trim();

  // دریافت دسترسی پایه نقش
  const basePermissionResult = getUserPermissions_(role);

  if (!basePermissionResult.success) {
    return {
      success: false,
      message: "نقش کاربر معتبر نیست"
    };
  }

  // دریافت دسترسی اختصاصی کاربر
  const extraResult = getUserExtraPermissions_(code);

  let finalExtraPermissions = {};

  if (extraResult.success && extraResult.found) {

    for (const permission in extraResult.permissions) {

      if (extraResult.permissions[permission] !== null) {

        finalExtraPermissions[permission] =
          extraResult.permissions[permission];
      }
    }
  }

  // اگر دسترسی اضافی از بیرون ارسال شده باشد
  if (extraPermissions) {

    for (const permission in extraPermissions) {

      if (extraPermissions[permission] !== null) {

        finalExtraPermissions[permission] =
          extraPermissions[permission];
      }
    }
  }

  // محاسبه دسترسی نهایی
  const permissionResult =
    getEffectivePermissions_(
      role,
      finalExtraPermissions
    );

  if (!permissionResult.success) {
    return {
      success: false,
      message: "خطا در محاسبه دسترسی‌ها"
    };
  }

  // کاربران سیستمی
  const systemUsers = {

    "1001": {
      name: "مدیر صندوق",
      role: "مدیر صندوق"
    },

    "1002": {
      name: "نایب رئیس",
      role: "نایب رئیس"
    },

    "1003": {
      name: "صندوق دار",
      role: "صندوق دار"
    },

    "1004": {
      name: "بازرس",
      role: "بازرس"
    },

    "1005": {
      name: "ناظر کارفرما",
      role: "ناظر کارفرما"
    }
  };

  // بررسی کاربران سیستمی
  if (systemUsers[code]) {

    return {
      success: true,
      found: true,

      user: {
        employeeCode: code,
        name: systemUsers[code].name,
        role: systemUsers[code].role,
        isManager:
          systemUsers[code].role === "مدیر صندوق"
      },

      permissions:
        permissionResult.permissions
    };
  }

  // بررسی عضو عادی
  const memberResult =
    getMemberByCode_(code);

  if (!memberResult.success) {

    return {
      success: false,
      found: false,
      message: "عضو با این کد پرسنلی پیدا نشد"
    };
  }

  // ساخت اطلاعات عضو از آرایه data
  const memberData = memberResult.data;

  return {
    success: true,
    found: true,

    user: {
      employeeCode: code,
      name: memberData[1] || "",
      role: "عضو",
      isManager: false,
      memberStatus: memberData[3] || ""
    },

    permissions:
      permissionResult.permissions
  };
}

function getUserExtraPermissions_(employeeCode) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("دسترسی کاربران");

  if (!sheet) {
    return {
      success: false,
      found: false,
      permissions: {},
      permissionLevels: {},
      message: "شیت دسترسی کاربران پیدا نشد"
    };
  }

  const data = sheet.getDataRange().getDisplayValues();

  if (data.length < 2) {
    return {
      success: true,
      found: false,
      permissions: {},
      permissionLevels: {}
    };
  }

  const code = String(employeeCode).trim();

  for (let r = 1; r < data.length; r++) {

    if (String(data[r][0]).trim() === code) {

      return {
        success: true,
        found: true,

        permissions: {
          dashboard: parseBooleanPermission_(data[r][1]),
          members: parseBooleanPermission_(data[r][2]),
          loans: parseBooleanPermission_(data[r][3]),
          moneyFlow: parseBooleanPermission_(data[r][4]),
          requests: parseBooleanPermission_(data[r][5]),
          announcements: parseBooleanPermission_(data[r][6]),
          settings: parseBooleanPermission_(data[r][7])
        },

        permissionLevels: {
          requests: parseManagementPermission_(data[r][5]),
          announcements: parseManagementPermission_(data[r][6])
        }
      };
    }
  }

  return {
    success: true,
    found: false,
    permissions: {},
    permissionLevels: {}
  };
}


/* =========================================
   دسترسی‌های معمولی
   فقط بله / خیر / پیش‌فرض
   ========================================= */

function parseBooleanPermission_(value) {

  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const text = String(value).trim().toLowerCase();

  if (
    text === "بله" ||
    text === "yes" ||
    text === "true" ||
    text === "1"
  ) {
    return true;
  }

  if (
    text === "خیر" ||
    text === "no" ||
    text === "false" ||
    text === "0"
  ) {
    return false;
  }

  return null;
}


/* =========================================
   سطح دسترسی درخواست و اعلانات
   پیش‌فرض / مشاهده / مدیریت
   ========================================= */

function parseManagementPermission_(value) {

  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const text = String(value).trim();

  if (
    text === "مدیریت" ||
    text.toLowerCase() === "manage"
  ) {
    return "manage";
  }

  if (
    text === "مشاهده" ||
    text.toLowerCase() === "view"
  ) {
    return "view";
  }

  return null;
}

function getUserAccessForManager_(employeeCode, requesterCode) {
  const requester = String(requesterCode || "").trim();
  if (requester !== "1001") return { success:false, authorized:false, message:"فقط مدیر صندوق مجاز به مدیریت دسترسی کاربران است" };
  const code = String(employeeCode || "").trim();
  if (!code || code === "1001") return { success:false, found:false, message:"مدیر صندوق دارای دسترسی کامل و ثابت است" };
  const systemUser = getSystemUserByCode_(code);
  let user = systemUser;
  if (!user) {
    const memberResult = getMemberByCode_(code);
    if (!memberResult || !memberResult.success) return { success:false, found:false, message:"کاربر با این کد پرسنلی پیدا نشد" };
    user = { name:memberResult.data[1] || "", role:"عضو", memberStatus:memberResult.data[3] || "" };
  }
  const extraResult = getUserExtraPermissions_(code);
  const storedPermissions = extraResult && extraResult.success && extraResult.found ? extraResult.permissions : {};
  const storedLevels = extraResult && extraResult.success && extraResult.found ? extraResult.permissionLevels : {};
  const baseResult = getUserPermissions_(user.role);
  const effectiveResult = getEffectivePermissions_(user.role, storedPermissions, storedLevels);
  return {
    success:true, authorized:true, found:true,
    user:{ employeeCode:code, name:user.name, role:user.role, memberStatus:user.memberStatus || "" },
    basePermissions:baseResult.permissions,
    customPermissions:storedPermissions,
    customPermissionLevels:storedLevels,
    effectivePermissions:effectiveResult.permissions,
    effectivePermissionLevels:effectiveResult.permissionLevels
  };
}

function testGetUserAccessForManager_() {

  const result =
    getUserAccessForManager_(
      "157",
      "1001"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


function updateUserPermission_(
  employeeCode,
  permission,
  value,
  requesterCode
) {

  const requester = String(requesterCode).trim();
  const code = String(employeeCode).trim();

  // فقط مدیر صندوق
  if (requester !== "1001") {
    return {
      success: false,
      authorized: false,
      message: "فقط مدیر صندوق مجاز به تغییر دسترسی کاربران است"
    };
  }

  if (!code || code === "1001" || !getRoleForEmployeeCode_(code)) {
    return { success:false, message:"کد پرسنلی معتبر نیست یا دسترسی مدیر صندوق قابل تغییر نیست" };
  }

  // دسترسی‌های مجاز
  const allowedPermissions = [
    "dashboard",
    "members",
    "loans",
    "moneyFlow",
    "requests",
    "announcements",
    "settings"
  ];

  if (!allowedPermissions.includes(permission)) {
    return {
      success: false,
      message: "نوع دسترسی نامعتبر است"
    };
  }

  // تبدیل مقدار به true / false / null
  let finalValue = null;

  if (
    value === true ||
    value === "true" ||
    value === "بله" ||
    value === 1 ||
    value === "1"
  ) {
    finalValue = true;
  }

  else if (
    value === false ||
    value === "false" ||
    value === "خیر" ||
    value === 0 ||
    value === "0"
  ) {
    finalValue = false;
  }

  else if (
    value === null ||
    value === "" ||
    value === "null" ||
    value === "inherit"
  ) {
    finalValue = null;
  }

  else {
    return {
      success: false,
      message: "مقدار دسترسی نامعتبر است"
    };
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    ss.getSheetByName("دسترسی کاربران");

  if (!sheet) {
    return {
      success: false,
      message: "شیت دسترسی کاربران پیدا نشد"
    };
  }

  const data =
    sheet.getDataRange().getDisplayValues();

  // ستون‌های دسترسی
  const permissionColumns = {
    dashboard: 1,
    members: 2,
    loans: 3,
    moneyFlow: 4,
    requests: 5,
    announcements: 6,
    settings: 7
  };

  const column =
    permissionColumns[permission];

  let targetRow = -1;

  // پیدا کردن کاربر
  for (let r = 1; r < data.length; r++) {

    if (
      String(data[r][0]).trim() === code
    ) {
      targetRow = r + 1;
      break;
    }
  }

  // اگر کاربر در شیت نبود، ردیف جدید ایجاد می‌کنیم
  if (targetRow === -1) {

    targetRow =
      sheet.getLastRow() + 1;

    sheet
      .getRange(targetRow, 1)
      .setValue(code);
  }

  // مقدار قابل ذخیره
  let sheetValue = "";

  if (finalValue === true) {
    sheetValue = "بله";
  }

  else if (finalValue === false) {
    sheetValue = "خیر";
  }

  // null یعنی ارث‌بری از نقش
  sheet
    .getRange(targetRow, column + 1)
    .setValue(sheetValue);

  return {
    success: true,
    authorized: true,
    employeeCode: code,
    permission: permission,
    value: finalValue,
    message: "دسترسی با موفقیت تغییر کرد"
  };
}


function testUpdateUserPermission_() {

  const result =
    updateUserPermission_(
      "157",
      "dashboard",
      true,
      "1001"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}

function testResetUserPermission_() {

  const result =
    updateUserPermission_(
      "157",
      "dashboard",
      null,
      "1001"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}

function testUnauthorizedUpdatePermission_() {

  const result =
    updateUserPermission_(
      "157",
      "dashboard",
      true,
      "1002"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}

function getUserAccessListForManager_(requesterCode) {

  const requester = String(requesterCode).trim();

  // فقط مدیر صندوق
  if (requester !== "1001") {
    return {
      success: false,
      authorized: false,
      message: "فقط مدیر صندوق مجاز به مشاهده مدیریت دسترسی کاربران است"
    };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("لیست اعضا");

  if (!sheet) {
    return {
      success: false,
      message: "شیت لیست اعضا پیدا نشد"
    };
  }

  const data = sheet.getDataRange().getDisplayValues();

  if (data.length < 3) {
    return {
      success: true,
      authorized: true,
      users: []
    };
  }

  const users = [];

  // کاربران سیستمی
  const systemUsers = [
    {
      employeeCode: "1001",
      name: "مدیر صندوق",
      role: "مدیر صندوق"
    },
    {
      employeeCode: "1002",
      name: "نایب رئیس",
      role: "نایب رئیس"
    },
    {
      employeeCode: "1003",
      name: "صندوق دار",
      role: "صندوق دار"
    },
    {
      employeeCode: "1004",
      name: "بازرس",
      role: "بازرس"
    },
    {
      employeeCode: "1005",
      name: "ناظر کارفرما",
      role: "ناظر کارفرما"
    }
  ];

  // افزودن کاربران سیستمی
  systemUsers.forEach(function(systemUser) {

    const permissionResult =
      getEffectivePermissions_(
        systemUser.role,
        null
      );

    users.push({
      employeeCode: systemUser.employeeCode,
      name: systemUser.name,
      role: systemUser.role,
      memberStatus: "سیستمی",
      permissions: permissionResult.permissions
    });

  });

  // اعضای صندوق
  for (let r = 2; r < data.length; r++) {

    const name =
      String(data[r][1] || "").trim();

    const employeeCode =
      String(data[r][2] || "").trim();

    const memberStatus =
      String(data[r][3] || "").trim();

    // ردیف‌های بدون کد پرسنلی نادیده گرفته شوند
    if (!employeeCode) {
      continue;
    }

    const extraResult =
      getUserExtraPermissions_(employeeCode);

    let extraPermissions = null;

    if (
      extraResult.success &&
      extraResult.found
    ) {
      extraPermissions =
        extraResult.permissions;
    }

    const permissionResult =
      getEffectivePermissions_(
        "عضو",
        extraPermissions
      );

    users.push({
      employeeCode: employeeCode,
      name: name,
      role: "عضو",
      memberStatus: memberStatus,
      permissions: permissionResult.permissions
    });
  }

  return {
    success: true,
    authorized: true,
    count: users.length,
    users: users
  };
}

function testGetUserAccessListForManager_() {

  const result =
    getUserAccessListForManager_("1001");

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


function searchUserAccessForManager_(
  employeeCode,
  requesterCode
) {

  const requester =
    String(requesterCode).trim();

  // فقط مدیر صندوق
  if (requester !== "1001") {

    return {
      success: false,
      authorized: false,
      message:
        "فقط مدیر صندوق مجاز به مشاهده دسترسی کاربران است"
    };
  }

  const code =
    String(employeeCode).trim();

  // کاربران سیستمی
  const systemUsers = {

    "1001": {
      name: "مدیر صندوق",
      role: "مدیر صندوق"
    },

    "1002": {
      name: "نایب رئیس",
      role: "نایب رئیس"
    },

    "1003": {
      name: "صندوق دار",
      role: "صندوق دار"
    },

    "1004": {
      name: "بازرس",
      role: "بازرس"
    },

    "1005": {
      name: "ناظر کارفرما",
      role: "ناظر کارفرما"
    }
  };

  // بررسی کاربر سیستمی
  if (systemUsers[code]) {

    const role =
      systemUsers[code].role;

    const extraResult =
      getUserExtraPermissions_(code);

    const customPermissions =
      extraResult.success &&
      extraResult.found
        ? extraResult.permissions
        : {
            dashboard: null,
            members: null,
            loans: null,
            moneyFlow: null,
            requests: null,
            announcements: null,
            settings: null
          };

    const baseResult =
      getUserPermissions_(role);

    const effectiveResult =
      getEffectivePermissions_(
        role,
        customPermissions
      );

    return {

      success: true,
      authorized: true,
      found: true,

      user: {
        employeeCode: code,
        name: systemUsers[code].name,
        role: role,
        memberStatus: "سیستمی"
      },

      basePermissions:
        baseResult.permissions,

      customPermissions:
        customPermissions,

      effectivePermissions:
        effectiveResult.permissions
    };
  }

  // =========================
  // عضو صندوق
  // =========================

  const memberResult =
    getMemberByCode_(code);

  if (!memberResult.success) {

    return {
      success: true,
      authorized: true,
      found: false,
      message:
        "عضو با این کد پرسنلی پیدا نشد"
    };
  }

  const memberData =
    memberResult.data;

  const extraResult =
    getUserExtraPermissions_(code);

  const customPermissions =
    extraResult.success &&
    extraResult.found
      ? extraResult.permissions
      : {
          dashboard: null,
          members: null,
          loans: null,
          moneyFlow: null,
          requests: null,
          announcements: null,
          settings: null
        };

  const baseResult =
    getUserPermissions_("عضو");

  const effectiveResult =
    getEffectivePermissions_(
      "عضو",
      customPermissions
    );

  return {

    success: true,
    authorized: true,
    found: true,

    user: {
      employeeCode: code,
      name: memberData[1] || "",
      role: "عضو",
      memberStatus: memberData[3] || ""
    },

    basePermissions:
      baseResult.permissions,

    customPermissions:
      customPermissions,

    effectivePermissions:
      effectiveResult.permissions
  };
}


function testSearchUserAccessForManager_() {

  const result =
    searchUserAccessForManager_(
      "157",
      "1001"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}

function updateUserPermissions_(
  employeeCode,
  permissions,
  requesterCode
) {

  const requester =
    String(requesterCode || "").trim();

  const code =
    String(employeeCode || "").trim();

  // فقط مدیر صندوق می‌تواند تنظیمات دسترسی را تغییر دهد
  if (requester !== "1001") {
    return {
      success: false,
      authorized: false,
      message:
        "فقط مدیر صندوق مجاز به تغییر دسترسی کاربران است"
    };
  }

  if (!code || code === "1001" || !getRoleForEmployeeCode_(code)) {
    return { success:false, message:"کد پرسنلی معتبر نیست یا دسترسی مدیر صندوق قابل تغییر نیست" };
  }

  if (
    !permissions ||
    typeof permissions !== "object"
  ) {
    return {
      success: false,
      message:
        "اطلاعات دسترسی‌ها معتبر نیست"
    };
  }

  const allowedPermissions = [
    "dashboard",
    "members",
    "loans",
    "moneyFlow",
    "requests",
    "announcements",
    "settings"
  ];

  function normalizeBooleanPermission(value) {

    if (
      value === true ||
      value === "true" ||
      value === "بله" ||
      value === 1 ||
      value === "1" ||
      value === "yes"
    ) {
      return true;
    }

    if (
      value === false ||
      value === "false" ||
      value === "خیر" ||
      value === 0 ||
      value === "0" ||
      value === "no"
    ) {
      return false;
    }

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      value === "null" ||
      value === "inherit"
    ) {
      return null;
    }

    return "invalid";
  }

  function normalizeSectionPermission(value) {

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      value === "null" ||
      value === "inherit" ||
      value === "پیش‌فرض نقش"
    ) {
      return null;
    }

    const text = String(value).trim().toLowerCase();

    if (
      text === "مدیریت" ||
      text === "manage"
    ) {
      return "manage";
    }

    if (
      text === "مشاهده" ||
      text === "view" ||
      text === "بله" ||
      text === "yes" ||
      text === "true" ||
      text === "1"
    ) {
      return "view";
    }

    if (
      text === "خیر" ||
      text === "no" ||
      text === "false" ||
      text === "0"
    ) {
      return false;
    }

    return "invalid";
  }

  const normalized = {};

  for (
    let i = 0;
    i < allowedPermissions.length;
    i++
  ) {

    const permission =
      allowedPermissions[i];

    let value;

    if (
      permission === "requests" ||
      permission === "announcements"
    ) {

      value =
        normalizeSectionPermission(
          permissions[permission]
        );

    } else {

      value =
        normalizeBooleanPermission(
          permissions[permission]
        );
    }

    if (value === "invalid") {

      return {
        success: false,
        message:
          "مقدار دسترسی «" +
          permission +
          "» نامعتبر است"
      };
    }

    normalized[permission] = value;
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    ss.getSheetByName("دسترسی کاربران");

  if (!sheet) {
    return {
      success: false,
      message:
        "شیت دسترسی کاربران پیدا نشد"
    };
  }

  const data =
    sheet.getDataRange().getDisplayValues();

  let targetRow = -1;

  for (
    let r = 1;
    r < data.length;
    r++
  ) {

    if (
      String(data[r][0]).trim() === code
    ) {

      targetRow = r + 1;
      break;
    }
  }

  if (targetRow === -1) {

    targetRow =
      sheet.getLastRow() + 1;

    sheet
      .getRange(targetRow, 1)
      .setValue(code);
  }

  const sheetValues = [

    // داشبورد
    normalized.dashboard === true
      ? "بله"
      : normalized.dashboard === false
        ? "خیر"
        : "",

    // اعضا
    normalized.members === true
      ? "بله"
      : normalized.members === false
        ? "خیر"
        : "",

    // وام
    normalized.loans === true
      ? "بله"
      : normalized.loans === false
        ? "خیر"
        : "",

    // مسیر پول
    normalized.moneyFlow === true
      ? "بله"
      : normalized.moneyFlow === false
        ? "خیر"
        : "",// درخواست‌ها
    normalized.requests === "manage"
      ? "مدیریت"
      : normalized.requests === "view"
        ? "مشاهده"
        : normalized.requests === false
          ? "خیر"
          : "",

    // اعلانات
    normalized.announcements === "manage"
      ? "مدیریت"
      : normalized.announcements === "view"
        ? "مشاهده"
        : normalized.announcements === false
          ? "خیر"
          : "",

    // تنظیمات
    normalized.settings === true
      ? "بله"
      : normalized.settings === false
        ? "خیر"
        : ""
  ];

  sheet
    .getRange(
      targetRow,
      2,
      1,
      7
    )
    .setValues([
      sheetValues
    ]);

  return {
    success: true,
    authorized: true,
    employeeCode: code,
    permissions: normalized,
    message:
      "دسترسی‌های کاربر با موفقیت به‌روزرسانی شد"
  };
}


function testUpdateUserPermissions_() {

  const result =
    updateUserPermissions_(
      "157",
      {
        dashboard: null,
        members: null,
        loans: true,
        moneyFlow: null,
        requests: null,
        announcements: false,
        settings: null
      },
      "1001"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


function testVerifyUpdatedPermissions_() {

  const result =
    getUserAccessForManager_(
      "157",
      "1001"
    );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}






function testConnection_() {
  return {
    success: true,
    message: "Backend is connected",
    time: new Date().toISOString()
  };
}




function hashPassword_(password) {
  // Legacy SHA-256 retained only to verify and transparently migrate old records.
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password), Utilities.Charset.UTF_8);
  return digest.map(function(byte) { const v=byte<0?byte+256:byte; return ("0"+v.toString(16)).slice(-2); }).join("");
}

function bytesToHex_(bytes) {
  return bytes.map(function(b){ var v=b<0?b+256:b; return ("0"+v.toString(16)).slice(-2); }).join("");
}
function hexToBytes_(hex) {
  var out=[]; for(var i=0;i<hex.length;i+=2) out.push(parseInt(hex.substr(i,2),16)); return out;
}
// Pure-JavaScript SHA-256 / HMAC implementation. This preserves the exact
// PBKDF2-HMAC-SHA256 format while avoiding 60,000 separate Apps Script service
// calls during one password verification.
var PJ_SHA256_K_ = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function pjSha256Bytes_(input) {
  var len=input.length, bitLen=len*8, total=((len+9+63)>>6)<<6, msg=new Array(total).fill(0);
  for(var q=0;q<len;q++) msg[q]=input[q]&255;
  msg[len]=128;
  var hi=Math.floor(bitLen/0x100000000), lo=bitLen>>>0;
  for(var z=0;z<4;z++){msg[total-8+z]=(hi>>>(24-8*z))&255;msg[total-4+z]=(lo>>>(24-8*z))&255;}
  var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w=new Array(64);
  function rotr(x,n){return (x>>>n)|(x<<(32-n));}
  for(var off=0;off<total;off+=64){
    for(var a=0;a<16;a++){var ix=off+a*4;w[a]=((msg[ix]<<24)|(msg[ix+1]<<16)|(msg[ix+2]<<8)|msg[ix+3])|0;}
    for(var b=16;b<64;b++){var x=w[b-15],y=w[b-2],s0=rotr(x,7)^rotr(x,18)^(x>>>3),s1=rotr(y,17)^rotr(y,19)^(y>>>10);w[b]=(w[b-16]+s0+w[b-7]+s1)|0;}
    var aa=H[0],bb=H[1],cc=H[2],dd=H[3],ee=H[4],ff=H[5],gg=H[6],hh=H[7];
    for(var r=0;r<64;r++){var S1=rotr(ee,6)^rotr(ee,11)^rotr(ee,25),ch=(ee&ff)^(~ee&gg),t1=(hh+S1+ch+PJ_SHA256_K_[r]+w[r])|0,S0=rotr(aa,2)^rotr(aa,13)^rotr(aa,22),maj=(aa&bb)^(aa&cc)^(bb&cc),t2=(S0+maj)|0;hh=gg;gg=ff;ff=ee;ee=(dd+t1)|0;dd=cc;cc=bb;bb=aa;aa=(t1+t2)|0;}
    H[0]=(H[0]+aa)|0;H[1]=(H[1]+bb)|0;H[2]=(H[2]+cc)|0;H[3]=(H[3]+dd)|0;H[4]=(H[4]+ee)|0;H[5]=(H[5]+ff)|0;H[6]=(H[6]+gg)|0;H[7]=(H[7]+hh)|0;
  }
  var out=[];for(var h=0;h<8;h++){var v=H[h];out.push((v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255);}return out;
}
function pjHmacSha256_(key, message) {
  if(key.length>64) key=pjSha256Bytes_(key);
  var inner=new Array(64), outer=new Array(64);
  for(var i=0;i<64;i++){var k=(key[i]||0)&255;inner[i]=k^0x36;outer[i]=k^0x5c;}
  return pjSha256Bytes_(outer.concat(pjSha256Bytes_(inner.concat(message))));
}
function pbkdf2PasswordHash_(password, saltHex, iterations) {
  var rounds=Math.max(10000,Number(iterations)||60000);
  var key=Utilities.newBlob(String(password)).getBytes();
  var salt=hexToBytes_(saltHex).concat([0,0,0,1]);
  var u=pjHmacSha256_(key,salt), t=u.slice();
  for(var i=1;i<rounds;i++){
    u=pjHmacSha256_(key,u);
    for(var j=0;j<t.length;j++) t[j]=(t[j]^u[j])&255;
  }
  return bytesToHex_(t);
}
function makePasswordRecord_(password) {
  var saltHex = bytesToHex_(Utilities.newBlob(Utilities.getUuid()+Utilities.getUuid()).getBytes()).substring(0,32);
  var rounds = 60000;
  return "pbkdf2$"+rounds+"$"+saltHex+"$"+pbkdf2PasswordHash_(password,saltHex,rounds);
}


function getPasswordSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("رمز کاربران");

  if (!sh) {
    sh = ss.insertSheet("رمز کاربران");
    sh.getRange(1, 1, 1, 4).setValues([
      ["کد پرسنلی", "رمز هش‌شده", "آخرین تغییر", "نیاز به تغییر رمز"]
    ]);
  }

  if (sh.getLastColumn() < 4) { sh.getRange(1,4).setValue("نیاز به تغییر رمز"); }
  return sh;
}

function getPasswordRow_(employeeCode) {
  const sh=getPasswordSheet_(), last=sh.getLastRow(), code=String(employeeCode||"").trim();
  if(last<2)return 0;
  const values=sh.getRange(2,1,last-1,1).getValues();
  for(let i=0;i<values.length;i++) if(String(values[i][0]||"").trim()===code)return i+2;
  return 0;
}
function needsPasswordChange_(employeeCode, loginRecord) {
  if(loginRecord && Object.prototype.hasOwnProperty.call(loginRecord,"forceChange")) return !!loginRecord.forceChange;
  const sh=getPasswordSheet_(), row=getPasswordRow_(employeeCode);
  if(!row)return true; // حساب بدون رمز ثبت‌شده باید با رمز موقت صادرشده فعال شود.
  return String(sh.getRange(row,4).getValue()||"").trim()==="بله";
}
function setPasswordChangeRequired_(employeeCode, required) {
  const sh=getPasswordSheet_(), row=getPasswordRow_(employeeCode);
  if(row) sh.getRange(row,4).setValue(required?"بله":"خیر");
  return true;
}

function getLoginPasswordRecord_(employeeCode) {
  const sh=getPasswordSheet_(), last=sh.getLastRow(), code=String(employeeCode||"").trim();
  if(last<2) return {hash:null,forceChange:true};
  const rows=sh.getRange(2,1,last-1,4).getValues();
  for(let i=0;i<rows.length;i++){
    if(String(rows[i][0]||"").trim()===code){
      return {hash:String(rows[i][1]||"").trim(),forceChange:String(rows[i][3]||"").trim()==="بله"};
    }
  }
  return {hash:null,forceChange:true};
}

function getStoredPasswordHash_(employeeCode) {
  const sh = getPasswordSheet_();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) return null;

  const data = sh.getRange(2, 1, lastRow - 1, 2).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(employeeCode).trim()) {
      return String(data[i][1]).trim();
    }
  }

  return null;
}


function setStoredPassword_(employeeCode, password) {
  const sh = getPasswordSheet_();
  const code = String(employeeCode).trim();
  const hash = makePasswordRecord_(password);
  const lastRow = sh.getLastRow();

  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, 1).getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === code) {
        sh.getRange(i + 2, 2, 1, 2).setValues([[hash, new Date()]]);
        if(sh.getLastColumn()<4) sh.getRange(1,4).setValue("نیاز به تغییر رمز");
        sh.getRange(i + 2, 4).setValue("خیر");
        revokeUserSessions_(code);
        return true;
      }
    }
  }

  sh.appendRow([code, hash, new Date(), "خیر"]);
  revokeUserSessions_(code);
  return true;
}


function verifyPassword_(employeeCode, password, storedHash) {
  const stored = arguments.length >= 3 ? storedHash : getStoredPasswordHash_(employeeCode);
  if (!stored) return false;
  if (stored.indexOf("pbkdf2$") === 0) {
    const parts=stored.split("$");
    if(parts.length!==4) return false;
    const calculated=pbkdf2PasswordHash_(password,parts[2],Number(parts[1]));
    return calculated===parts[3];
  }
  // Migrate legacy unsalted SHA-256 hashes after a successful verification.
  if (stored === hashPassword_(password)) {
    setStoredPassword_(employeeCode,password);
    return true;
  }
  return false;
}

function loginFailureState_(employeeCode) {
  var key="PJ10_LOGIN_FAIL_"+String(employeeCode||"").trim();
  var raw=CacheService.getScriptCache().get(key), count=Number(raw||0);
  return {key:key,count:count,locked:count>=5};
}
function recordLoginFailure_(employeeCode) {
  var lock=LockService.getScriptLock(), key="PJ10_LOGIN_FAIL_"+String(employeeCode||"").trim(), next=1;
  lock.waitLock(5000);
  try {
    var cache=CacheService.getScriptCache(), count=Number(cache.get(key)||0);
    next=count+1; cache.put(key,String(next),900);
  } finally { lock.releaseLock(); }
  return {locked:next>=5,remaining:Math.max(0,5-next)};
}
function clearLoginFailures_(employeeCode) {
  CacheService.getScriptCache().remove("PJ10_LOGIN_FAIL_"+String(employeeCode||"").trim());
}

function generateTemporaryPassword_() {
  var alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid()+Utilities.getUuid());
  var out="";
  for(var i=0;i<12;i++) out+=alphabet[(bytes[i] & 255)%alphabet.length];
  return out;
}
function issueTemporaryPassword_(code) {
  var password=generateTemporaryPassword_();
  setStoredPassword_(code,password);
  setPasswordChangeRequired_(code,true);
  clearLoginFailures_(code);
  return password;
}
// Run once from the Apps Script editor only if manager 1001 has no password record.
// Copy the one-time credential from the execution log, sign in, then change it immediately.
function provisionManagerInitialPassword_() {
  var code="1001", rec=getLoginPasswordRecord_(code);
  if(rec.hash) throw new Error("برای مدیر صندوق قبلاً رمز ثبت شده است؛ از بازنشانی عادی استفاده کنید.");
  var password=generateTemporaryPassword_();
  setStoredPassword_(code,password);
  setPasswordChangeRequired_(code,true);
  Logger.log("Manager one-time password: "+password);
  return "رمز موقت مدیر در Execution log ثبت شد. آن را محرمانه بردارید و پس از ورود تغییر دهید.";
}

function issueInitialPasswords_(requesterCode) {
  if(!isManagerCode_(requesterCode)) return {success:false,authorized:false,message:"فقط مدیر صندوق مجاز به صدور رمز است"};
  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("لیست اعضا");
  if(!sh || sh.getLastRow()<3) return {success:false,message:"فهرست اعضا در دسترس نیست"};
  var rows=sh.getRange(3,3,sh.getLastRow()-2,2).getDisplayValues(), credentials=[];
  // حساب‌های سازمانی نیز باید رمز اختصاصی داشته باشند.
  var system=["1001","1002","1003","1004","1005"];
  system.forEach(function(code){ credentials.push({employeeCode:code,name:getSystemUserByCode_(code).name,password:issueTemporaryPassword_(code)}); });
  rows.forEach(function(r){
    var code=String(r[0]||"").trim(), status=String(r[1]||"").trim();
    if(code && status==="فعال") {
      var member=getMemberByCode_(code);
      credentials.push({employeeCode:code,name:member&&member.success?String(member.data[1]||""):"",password:issueTemporaryPassword_(code)});
    }
  });
  return {success:true,credentials:credentials,count:credentials.length,message:"رمزهای موقت صادر شدند. این فهرست فقط همین یک‌بار نمایش داده می‌شود؛ فوراً چاپ و تحویل دهید."};
}



function resetEmployeePassword_(targetCode, requesterCode) {
  if(!isManagerCode_(requesterCode)) return {success:false,authorized:false,message:"فقط مدیر صندوق مجاز به بازنشانی رمز است"};
  const code=String(targetCode||"").trim();
  if(!code || code==="1001") return {success:false,message:"کد پرسنلی معتبر نیست"};
  if(!getSystemUserByCode_(code) && !(getMemberByCode_(code)||{}).success) return {success:false,message:"کاربر با این کد پرسنلی پیدا نشد"};
  var password=issueTemporaryPassword_(code);
  return {success:true,employeeCode:code,temporaryPassword:password,mustChangePassword:true,message:"رمز موقت جدید صادر شد. آن را فقط یک‌بار نمایش‌داده‌شده تلقی کنید و محرمانه تحویل دهید."};
}

function changeMyPassword_(employeeCode, oldPassword, newPassword) {
  const code = String(employeeCode).trim();

  if (!code) {
    return {
      success: false,
      message: "کد پرسنلی معتبر نیست"
    };
  }

  if (!oldPassword || !newPassword) {
    return {
      success: false,
      message: "رمز فعلی و رمز جدید الزامی است"
    };
  }

  if (String(newPassword).length < 6) {
    return {
      success: false,
      message: "رمز جدید باید حداقل ۶ کاراکتر باشد"
    };
  }

  if (!verifyPassword_(code, oldPassword)) {
    return {
      success: false,
      message: "رمز فعلی اشتباه است"
    };
  }

  if (String(oldPassword) === String(newPassword)) {
    return {
      success: false,
      message: "رمز جدید باید با رمز فعلی متفاوت باشد"
    };
  }

  setStoredPassword_(code, newPassword);

  return {
    success: true,
    employeeCode: code,
    message: "رمز عبور با موفقیت تغییر کرد"
  };
}


// =====================================================
// REQUESTS - صندوق پرشیا جام
// =====================================================

function getRequestsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("درخواست ها");

  if (!sh) {
    sh = ss.insertSheet("درخواست ها");

    sh.getRange(1, 1, 1, 17).setValues([[
      "ردیف","کد پرسنلی","نام درخواست‌دهنده","نوع درخواست","عنوان درخواست","شرح درخواست","تاریخ ثبت","وضعیت","پاسخ مدیر","تاریخ بررسی","بررسی‌کننده",
      "نظر نایب‌رئیس","دلیل نایب‌رئیس","زمان نظر نایب‌رئیس","نظر صندوق‌دار","دلیل صندوق‌دار","زمان نظر صندوق‌دار"
    ]]);
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < 17) {
    sh.getRange(1, 12, 1, 6).setValues([["نظر نایب‌رئیس","دلیل نایب‌رئیس","زمان نظر نایب‌رئیس","نظر صندوق‌دار","دلیل صندوق‌دار","زمان نظر صندوق‌دار"]]);
  }
  return sh;
}


// -----------------------------------------------------
// ثبت درخواست توسط عضو
// -----------------------------------------------------

function createRequest_(employeeCode, requestType, title, description) {

  const code = String(employeeCode || "").trim();
  const type = String(requestType || "").trim();
  const requestTitle = String(title || "").trim();
  const desc = String(description || "").trim();

  if (!code) {
    return {
      success: false,
      message: "کد پرسنلی معتبر نیست"
    };
  }

  if (!type) {
    return {
      success: false,
      message: "نوع درخواست را انتخاب کنید"
    };
  }

  // فعلاً فقط وام اضطراری و سایر درخواست‌ها قابل ثبت هستند.
  // وام خرد و پیش‌پرداخت وام اصلی تا زمان راه‌اندازی باید در سمت سرور نیز مسدود باشند.
  const allowedTypes = [
    "وام اضطراری",
    "سایر درخواست"
  ];

  if (allowedTypes.indexOf(type) === -1) {
    return {
      success: false,
      message: "نوع درخواست معتبر نیست"
    };
  }

  if (!requestTitle) {
    return {
      success: false,
      message: "عنوان درخواست الزامی است"
    };
  }

  if (!desc) {
    return {
      success: false,
      message: "شرح درخواست الزامی است"
    };
  }

  // بررسی وجود عضو
  const memberResult = getMemberByCode_(code);

  if (!memberResult || !memberResult.success) {
    return {
      success: false,
      message: "عضو با این کد پرسنلی پیدا نشد"
    };
  }

  const memberData = memberResult.data;
  const memberStatus = String(memberData[3] || "").trim();

  if (memberStatus !== "فعال") {
    return {
      success: false,
      message: "ثبت درخواست فقط برای اعضای فعال امکان‌پذیر است"
    };
  }

  const memberName = String(memberData[1] || "").trim();

  const sh = getRequestsSheet_();

  const nextRow = sh.getLastRow() + 1;
  const requestNumber = Math.max(1, nextRow - 1);

  sh.getRange(nextRow, 1, 1, 11).setValues([[
    requestNumber,
    code,
    memberName,
    type,
    requestTitle,
    desc,
    new Date(),
    "در انتظار بررسی",
    "",
    "",
    ""
  ]]);

  return {
    success: true,
    request: {
      id: requestNumber,
      employeeCode: code,
      name: memberName,
      type: type,
      title: requestTitle,
      description: desc,
      status: "در انتظار بررسی"
    },
    message: "درخواست با موفقیت ثبت شد"
  };
}


// -----------------------------------------------------
// دریافت درخواست‌های خود عضو
// -----------------------------------------------------

function getMyRequests_(employeeCode) {

  const code = String(employeeCode || "").trim();

  if (!code) {
    return {
      success: false,
      message: "کد پرسنلی معتبر نیست"
    };
  }

  const sh = getRequestsSheet_();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    return {
      success: true,
      requests: []
    };
  }

  const data = sh.getRange(2, 1, lastRow - 1, 17).getValues();

  const requests = [];

  data.forEach(function(row) {

    if (String(row[1]).trim() !== code) return;

    requests.push({
      id: row[0],
      employeeCode: row[1],
      name: row[2],
      type: row[3],
      title: row[4],
      description: row[5],
      createdAt: row[6],
      status: row[7],
      managerResponse: row[8],
      reviewedAt: row[9],
      reviewer: row[10],
      viceChairOpinion:row[11] || "", viceChairReason:row[12] || "", viceChairAt:row[13] || "",
      cashierOpinion:row[14] || "", cashierReason:row[15] || "", cashierAt:row[16] || ""
    });

  });

  return {
    success: true,
    requests: requests
  };
}


// -----------------------------------------------------
// دریافت تمام درخواست‌ها برای مدیر
// -----------------------------------------------------

function getAllRequestsForManager_(requesterCode) {
  const access = getSectionAccess_(requesterCode, "requests");
  if (!access.success || (access.level !== "view" && access.level !== "manage")) {
    return { success: false, authorized: false, message: "برای مشاهده درخواست‌های سایر اعضا دسترسی ندارید" };
  }
  const sh = getRequestsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { success: true, authorized: true, level: access.level, requests: [] };
  const data = sh.getRange(2, 1, lastRow - 1, 17).getValues();
  const viewerCode = String(requesterCode || "").trim();
  const isFundManager = viewerCode === "1001";
  const isViceChair = viewerCode === "1002";
  const isCashier = viewerCode === "1003";
  const requests = data.filter(function(row) { return String(row[0] || "").trim() !== ""; }).map(function(row) {
    return {
      id: row[0], employeeCode: row[1], name: row[2], type: row[3], title: row[4], description: row[5], createdAt: row[6], status: row[7], managerResponse: row[8], reviewedAt: row[9], reviewer: row[10],
      // مدیر هر دو نظر را می‌بیند؛ هر عضو کمیته فقط نظر خودش را؛ سایر نقش‌ها هیچ‌کدام را دریافت نمی‌کنند.
      viceChairOpinion: (isFundManager || isViceChair) ? (row[11] || "") : "",
      viceChairReason: (isFundManager || isViceChair) ? (row[12] || "") : "",
      viceChairAt: (isFundManager || isViceChair) ? (row[13] || "") : "",
      cashierOpinion: (isFundManager || isCashier) ? (row[14] || "") : "",
      cashierReason: (isFundManager || isCashier) ? (row[15] || "") : "",
      cashierAt: (isFundManager || isCashier) ? (row[16] || "") : ""
    };
  });
  return { success: true, authorized: true, level: access.level, requests: requests };
}

function isManagerCode_(employeeCode) {

  const code = String(employeeCode || "").trim();

  return code === "1001";
}

function testCreateRequest_() {
  const result = createRequest_(
    "157",
    "وام خرد",
    "درخواست وام خرد",
    "نیاز به وام خرد برای هزینه ضروری"
  );

  Logger.log(JSON.stringify(result, null, 2));
}

function testGetAllRequests_() {
  const result = getAllRequestsForManager_("1001");
  Logger.log(JSON.stringify(result, null, 2));
}

function testReviewRequest_() {
  const result = reviewRequest_(
    "1001",
    "3",
    "تأیید شد",
    "درخواست مورد تأیید است"
  );

  Logger.log(JSON.stringify(result, null, 2));
}



function fixOldRequestsStructure_() {

  const sh = getRequestsSheet_();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    return {
      success: true,
      fixed: 0,
      message: "درخواستی برای اصلاح وجود ندارد"
    };
  }

  const data = sh.getRange(2, 1, lastRow - 1, 11).getValues();

  let fixed = 0;

  data.forEach(function(row, index) {

    // ساختار قدیمی:
    // A id
    // B code
    // C name
    // D type
    // E title
    // F createdAt
    // G status
    // H managerResponse
    // I reviewedAt
    //
    // ساختار جدید:
    // A id
    // B code
    // C name
    // D type
    // E title
    // F description
    // G createdAt
    // H status
    // I managerResponse
    // J reviewedAt
    // K reviewer

    const possibleDate = row[5];

    if (
      possibleDate instanceof Date &&
      row[6] &&
      (
        String(row[6]).trim() === "تأیید شده" ||
        String(row[6]).trim() === "تأیید شد" ||
        String(row[6]).trim() === "رد شده" ||
        String(row[6]).trim() === "رد شد" ||
        String(row[6]).trim() === "در انتظار بررسی"
      )
    ) {

      const newRow = [
        row[0],       // id
        row[1],       // code
        row[2],       // name
        row[3],       // type
        row[4],       // title
        "",           // description
        row[5],       // createdAt
        row[6],       // status
        row[7],       // managerResponse
        row[8] || "", // reviewedAt
        ""            // reviewer
      ];

      sh.getRange(index + 2, 1, 1, 11).setValues([newRow]);

      fixed++;
    }

  });

  return {
    success: true,
    fixed: fixed,
    message: fixed + " درخواست قدیمی اصلاح شد"
  };
}

function testFixOldRequests_() {

  const result = fixOldRequestsStructure_();

  Logger.log(JSON.stringify(result, null, 2));

}

function testGetMyRequests_() {
  const result = getMyRequests_("157");
  Logger.log(JSON.stringify(result, null, 2));
}

function testCreatePendingRequest_() {
  const result = createRequest_(
    "157",
    "پیش پرداخت وام اصلی",
    "درخواست پیش پرداخت وام اصلی",
    "این درخواست صرفاً برای تست مسیر بررسی مدیر ثبت شده است."
  );

  Logger.log(JSON.stringify(result, null, 2));
}

function testReviewRequest4_() {
  const result = reviewRequest_(
    "1001",
    "4",
    "تأیید شد",
    "درخواست مورد تأیید است و برای ثبت مالی ارسال می‌شود."
  );

  Logger.log(JSON.stringify(result, null, 2));
}


function testGetMyRequestsAfterReview_() {
  const result = getMyRequests_("157");
  Logger.log(JSON.stringify(result, null, 2));
}

function getAnnouncementsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("اعلانات");
  if (!sh) sh = ss.insertSheet("اعلانات");

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 6).setValues([["شناسه", "عنوان اطلاعیه", "متن اطلاعیه", "تاریخ ثبت", "وضعیت", "ثبت‌کننده"]]);
    sh.setFrozenRows(1);
    return sh;
  }

  const lastCol = Math.max(sh.getLastColumn(), 5);
  const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function(v) { return String(v || "").trim(); });
  const fifth = headers[4] || "";
  const fifthIsCreator = fifth.indexOf("ثبت") >= 0 || fifth.indexOf("ایجاد") >= 0 || fifth.toLowerCase().indexOf("creator") >= 0;
  const fifthIsStatus = fifth.indexOf("وضعیت") >= 0 || fifth.toLowerCase().indexOf("status") >= 0;

  // سازگاری با ساختار پنج‌ستونی نسخه قبلی: ستون پنجمِ ثبت‌کننده
  // به ستون ششم منتقل و ستون پنجم به وضعیت انتشار تبدیل می‌شود.
  if (fifthIsCreator && !fifthIsStatus) {
    const rows = Math.max(0, sh.getLastRow() - 1);
    const creators = rows ? sh.getRange(2, 5, rows, 1).getValues() : [];
    sh.insertColumnAfter(5);
    sh.getRange(1, 5).setValue("وضعیت");
    sh.getRange(1, 6).setValue("ثبت‌کننده");
    if (rows) {
      sh.getRange(2, 5, rows, 1).setValues(Array.from({ length: rows }, function() { return ["منتشر شده"]; }));
      sh.getRange(2, 6, rows, 1).setValues(creators);
    }
  } else if (!fifthIsStatus) {
    // اگر شیت قدیمی سربرگ ناقص داشت، آن را بدون حذف داده‌ها به قالب شش‌ستونی می‌بریم.
    if (sh.getLastColumn() < 6) sh.insertColumnAfter(5);
    sh.getRange(1, 5).setValue("وضعیت");
    sh.getRange(1, 6).setValue("ثبت‌کننده");
    const rows = Math.max(0, sh.getLastRow() - 1);
    if (rows) {
      const statuses = sh.getRange(2, 5, rows, 1).getValues();
      sh.getRange(2, 5, rows, 1).setValues(statuses.map(function(r) { return [String(r[0] || "منتشر شده")]; }));
    }
  } else {
    sh.getRange(1, 6).setValue(headers[5] || "ثبت‌کننده");
  }
  sh.setFrozenRows(1);
  return sh;
}

function getAnnouncementReadsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("خواندن اعلانات");
  if (!sh) sh = ss.insertSheet("خواندن اعلانات");
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([["شناسه اطلاعیه", "کد پرسنلی", "تاریخ مشاهده"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function createAnnouncement_(requesterCode, title, text) {
  const code = String(requesterCode || "").trim();
  const access = getSectionAccess_(code, "announcements");
  if (!access.success || access.level !== "manage") return { success: false, authorized: false, message: "برای انتشار اطلاعیه دسترسی مدیریتی ندارید" };
  const announcementTitle = String(title || "").trim();
  const announcementText = String(text || "").trim();
  if (!announcementTitle || !announcementText) return { success: false, message: "عنوان و متن اطلاعیه الزامی است" };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getAnnouncementsSheet_();
    const id = "ANN-" + new Date().getTime() + "-" + code;
    const date = new Date();
    sh.appendRow([id, announcementTitle, announcementText, date, "منتشر شده", code]);
    return { success: true, announcementId: id, message: "اطلاعیه با موفقیت ثبت شد" };
  } finally {
    lock.releaseLock();
  }
}

function markAnnouncementRead_(employeeCode, announcementId) {
  const code = String(employeeCode || "").trim();
  const id = String(announcementId || "").trim();
  if (!code || !id) return { success: false, message: "کد پرسنلی و شناسه اطلاعیه الزامی است" };
  const current = getAnnouncements_(code);
  if (!current.success) return current;
  if (!current.announcements.some(function(x) { return String(x.id) === id; })) return { success: false, message: "اطلاعیه معتبر یا منتشرشده نیست" };

  const sh = getAnnouncementReadsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const rows = sh.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
    const alreadyRead = rows.some(function(r) { return String(r[0]).trim() === id && String(r[1]).trim() === code; });
    if (alreadyRead) return { success: true, unreadCount: current.unreadCount, message: "این اطلاعیه قبلاً مشاهده شده است" };
  }
  sh.appendRow([id, code, new Date()]);
  const updated = getAnnouncements_(code);
  return { success: true, unreadCount: updated.success ? updated.unreadCount : 0, message: "اطلاعیه به‌عنوان خوانده‌شده ثبت شد" };
}

function deleteAnnouncement_(requesterCode, announcementId) {
  const code = String(requesterCode || "").trim();
  const id = String(announcementId || "").trim();
  const access = getSectionAccess_(code, "announcements");
  if (!access.success || access.level !== "manage") return { success: false, authorized: false, message: "برای حذف اطلاعیه دسترسی مدیریتی ندارید" };
  if (!id) return { success: false, message: "شناسه اطلاعیه معتبر نیست" };

  const sh = getAnnouncementsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { success: false, message: "اطلاعیه‌ای وجود ندارد" };
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      sh.deleteRow(i + 2);
      const reads = getAnnouncementReadsSheet_();
      if (reads.getLastRow() >= 2) {
        const rr = reads.getRange(2, 1, reads.getLastRow() - 1, 3).getDisplayValues();
        for (let j = rr.length - 1; j >= 0; j--) if (String(rr[j][0]).trim() === id) reads.deleteRow(j + 2);
      }
      return { success: true, authorized: true, message: "اطلاعیه حذف شد" };
    }
  }
  return { success: false, message: "اطلاعیه پیدا نشد" };
}

function testMember157_() {
  const result = getMemberByCode_("157");
  Logger.log(JSON.stringify(result, null, 2));
}



function testLoan157_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("مدیریت وام‌ها");

  const lastRow = sh.getLastRow();
  const lastColumn = sh.getLastColumn();

  const data = sh
    .getRange(1, 1, lastRow, lastColumn)
    .getDisplayValues();

  const result = data.filter(function(row) {
    return String(row[2]).trim() === "157";
  });

  Logger.log(JSON.stringify(result, null, 2));
}



function getMemberProfile_(employeeCode) {
  var code = String(employeeCode == null ? "" : employeeCode).trim();
  if (!code) return { success: false, message: "کد پرسنلی معتبر نیست" };
  var memberResult = getMemberByCode_(code);
  if (!memberResult || !memberResult.success) return { success: false, message: "عضو پیدا نشد" };
  var d = memberResult.data;
  var memberName = String(d[1] || "").trim();
  var loanResult = getLoanByCode_(code);
  var loan = loanResult && loanResult.success && loanResult.hasActiveLoan ? loanResult.loan : null;
  var savings = toNumber_(d[9]);
  var remainingLoan = loan ? toNumber_(loan.remainingDebt) : toNumber_(d[16]);
  var net = savings - remainingLoan;
  var financialStatus = net > 0 ? "بستانکار" : net < 0 ? "بدهکار" : "تسویه";

  // ستون M شیت «لیست اعضا» نام ضامن هر وام‌گیرنده را نگه می‌دارد.
  // بنابراین برای یافتن افرادی که این عضو ضامن آن‌هاست، کل ستون M بررسی می‌شود.
  var guaranteesGiven = [];
  var membersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("لیست اعضا");
  if (membersSheet && memberName) {
    var lastRow = membersSheet.getLastRow();
    if (lastRow >= 3) {
      var rows = membersSheet.getRange(3, 1, lastRow - 2, 13).getDisplayValues();
      rows.forEach(function(row) {
        var guarantor = String(row[12] || "").trim();
        if (guarantor && guarantor === memberName) {
          var borrowerName = String(row[1] || "").trim();
          var borrowerCode = String(row[2] || "").trim();
          if (borrowerName) guaranteesGiven.push(borrowerName + (borrowerCode ? " (کد " + borrowerCode + ")" : ""));
        }
      });
    }
  }

  // ستون G عدد ماه شروع عضویت است؛ طبق سربرگ شیت، ماه ۱ برابر خرداد ۱۴۰۵ است.
  var startMonthNumber = toNumber_(d[6]);
  var persianMonths = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
  var membershipStartLabel = d[6] || "";
  if (startMonthNumber > 0) {
    var monthIndex = 2 + startMonthNumber; // 1 = خرداد 1405
    var startYear = 1405 + Math.floor((monthIndex - 1) / 12);
    var monthInYear = ((monthIndex - 1) % 12) + 1;
    membershipStartLabel = persianMonths[monthInYear - 1] + " " + startYear + " (ماه " + startMonthNumber + ")";
  }

  return { success: true, profile: {
    employeeCode: code, name: memberName, memberStatus: d[3] || "",
    serviceYears: d[4] || "", serviceEquivalent: d[5] || "",
    membershipStartMonth: membershipStartLabel, membershipLoanMonth: d[7] || "",
    membershipMonths: d[8] || "", accumulatedSavings: savings,
    totalGuarantee: toNumber_(d[10]), guaranteeType: d[11] || "", guarantorName: d[12] || "",
    loanStatus: d[13] || "", paidInstallments: loan ? loan.paidInstallments : toNumber_(d[14]),
    receivedLoan: loan ? loan.loanAmount : toNumber_(d[15]), remainingLoan: remainingLoan,
    membershipExitDate: d[19] || "", membershipExitMonth: d[20] || "",
    finalSettlementDate: d[21] || "", finalSettlementMonth: d[22] || "", settlementAmount: d[23] || "",
    loan: loan, financialStatus: { status: financialStatus, amount: Math.abs(net) },
    guarantorName: d[12] || "", guaranteedPeople: [], guaranteesGiven: guaranteesGiven
  } };
}function testMemberProfile157() {
  const result = getMemberProfile_("157");
  Logger.log(JSON.stringify(result, null, 2));
}




function getSectionAccess_(employeeCode, section) {
  const code = String(employeeCode || "").trim();
  if (!code) return { success: false, authorized: false, level: null, message: "کد پرسنلی معتبر نیست" };

  const systemUsers = {
    "1001": "مدیر صندوق",
    "1002": "نایب رئیس",
    "1003": "صندوق دار",
    "1004": "بازرس",
    "1005": "ناظر کارفرما"
  };
  let role = systemUsers[code] || null;
  if (!role) {
    const member = getMemberByCode_(code);
    if (!member || !member.success) return { success: false, authorized: false, level: null, message: "کاربر پیدا نشد" };
    role = "عضو";
  }

  const extra = getUserExtraPermissions_(code);
  const effective = getEffectivePermissions_(
    role,
    extra && extra.success && extra.found ? extra.permissions : {},
    extra && extra.success && extra.found ? extra.permissionLevels : {}
  );
  if (!effective.success) return { success: false, authorized: false, level: null, message: "خطا در محاسبه دسترسی" };

  if (section !== "requests" && section !== "announcements") {
    return { success: false, authorized: false, level: null, message: "بخش موردنظر معتبر نیست" };
  }
  const level = effective.permissionLevels[section];
  return { success: true, authorized: level === "view" || level === "manage", level: level, role: role };
}



// =====================================================
// V10 UNIFIED AUTHENTICATION AND SESSION CONTROL
// =====================================================
function getUserSessionVersion_(employeeCode) {
  return PropertiesService.getScriptProperties().getProperty("PJ10_SESSION_VERSION_"+String(employeeCode||"").trim()) || "1";
}
function revokeUserSessions_(employeeCode) {
  var props=PropertiesService.getScriptProperties(), key="PJ10_SESSION_VERSION_"+String(employeeCode||"").trim();
  props.setProperty(key,String(Number(props.getProperty(key)||"1")+1));
  return true;
}
function createApiSession_(employeeCode) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const code=String(employeeCode||"").trim();
  CacheService.getScriptCache().put("PJ10_SESSION_" + token, code+"|"+getUserSessionVersion_(code), 21600);
  return token;
}
function getApiSession_(token) {
  const key = String(token || "").trim();
  if (!key) return null;
  const stored=CacheService.getScriptCache().get("PJ10_SESSION_" + key);
  if(!stored || stored.indexOf("|")<0)return null;
  const parts=stored.split("|"), code=parts[0];
  return parts[1]===getUserSessionVersion_(code)?code:null;
}

function authorizeApiRequest_(data, action) {
  const code = getApiSession_(data && data.token);
  if (!code) return { success: false, authorized: false, message: "نشست ورود معتبر نیست یا منقضی شده است؛ دوباره وارد شوید" };
  if (!isEmployeeActive_(code)) { revokeUserSessions_(code); return {success:false,authorized:false,message:"عضویت شما فعال نیست؛ دسترسی سامانه مسدود شده است."}; }

  const managerActions = [
    "getAllRequestsForManager", "reviewRequest", "submitCommitteeOpinion", "createAnnouncement", "deleteAnnouncement",
    "getUserAccessForManager", "getUserAccess", "searchUserAccess", "updateUserPermission",
    "updateUserPermissions", "getUserAccessList", "resetEmployeePassword", "issueInitialPasswords"
  ];
  const suppliedCode = (managerActions.indexOf(action) >= 0 || action === "submitCommitteeOpinion")
    ? String(data.requesterCode || "").trim()
    : String(data.employeeCode || "").trim();

  if (!suppliedCode || suppliedCode !== code) {
    return { success: false, authorized: false, message: "هویت ارسال‌کننده با نشست ورود مطابقت ندارد" };
  }
  if (needsPasswordChange_(code) && action !== "changeMyPassword") {
    return { success:false, authorized:false, mustChangePassword:true, message:"برای ادامه باید ابتدا رمز عبور خود را تغییر دهید" };
  }
  return { success: true, employeeCode: code };
}

function isEmployeeActive_(code) {
  if(getSystemUserByCode_(code)) return true;
  var member=getMemberByCode_(code);
  return !!(member && member.success && String(member.data[3]||"").trim()==="فعال");
}

function loginUser_(employeeCode, password) {
  var totalStart=Date.now(), phaseStart=totalStart, timings={};
  const code = String(employeeCode || "").trim();
  if (!code || password === undefined || password === null || String(password) === "") {
    return { success: false, message: "کد پرسنلی و رمز عبور الزامی است" };
  }

  const systemUsers = {
    "1001": { name: "مدیر صندوق", role: "مدیر صندوق" },
    "1002": { name: "نایب رئیس", role: "نایب رئیس" },
    "1003": { name: "صندوق دار", role: "صندوق دار" },
    "1004": { name: "بازرس", role: "بازرس" },
    "1005": { name: "ناظر کارفرما", role: "ناظر کارفرما" }
  };

  let user = systemUsers[code] || null;
  if (!user) {
    const member = getMemberByCode_(code);
    if (!member || !member.success) return { success: false, message: "کد پرسنلی یا رمز عبور صحیح نیست" };
    user = { name: String(member.data[1] || "").trim(), role: "عضو", memberStatus: String(member.data[3] || "").trim() };
    if (user.memberStatus !== "فعال") return { success:false, message:"دسترسی این عضو غیرفعال است. برای فعال‌سازی با مدیر صندوق تماس بگیرید." };
  }
  timings.userLookupMs=Date.now()-phaseStart; phaseStart=Date.now();

  const lockState=loginFailureState_(code);
  if(lockState.locked) return {success:false,locked:true,message:"حساب به‌دلیل ۵ تلاش ناموفق قفل شده است. ۱۵ دقیقه بعد دوباره تلاش کنید یا از مدیر صندوق بخواهید رمز را بازنشانی کند."};

  const passwordRecord=getLoginPasswordRecord_(code);
  if (!verifyPassword_(code, password, passwordRecord.hash)) {
    const failure=recordLoginFailure_(code);
    return { success:false, locked:failure.locked, message:failure.locked ? "حساب پس از ۵ تلاش ناموفق به مدت ۱۵ دقیقه قفل شد." : "کد پرسنلی یا رمز عبور صحیح نیست. تلاش باقی‌مانده: "+failure.remaining };
  }
  timings.passwordVerifyMs=Date.now()-phaseStart; phaseStart=Date.now();
  clearLoginFailures_(code);

  const extra = user.role === "مدیر صندوق" ? { success:true, found:false, permissions:{}, permissionLevels:{} } : getUserExtraPermissions_(code);
  const effective = getEffectivePermissions_(
    user.role,
    extra && extra.success && extra.found ? extra.permissions : {},
    extra && extra.success && extra.found ? extra.permissionLevels : {}
  );
  if (!effective.success) return { success: false, message: "محاسبه سطح دسترسی کاربر ناموفق بود" };
  timings.permissionsMs=Date.now()-phaseStart; phaseStart=Date.now();

  const token = createApiSession_(code);
  const mustChange=passwordRecord.forceChange;
  timings.sessionAndFlagsMs=Date.now()-phaseStart;
  timings.totalMs=Date.now()-totalStart;
  // Durations only: never log password, hash, token, or other credentials.
  console.log("PJ10_LOGIN_TIMING "+JSON.stringify(timings));
  return {
    success: true,
    token: token,
    expiresInSeconds: 21600,
    user: { employeeCode: code, name: user.name, role: user.role, memberStatus: user.memberStatus || "" },
    permissions: effective.permissions,
    permissionLevels: effective.permissionLevels,
    mustChangePassword: mustChange
  };
}

