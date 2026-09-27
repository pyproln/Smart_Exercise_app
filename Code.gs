/* =====================================================================
   MY HOME WORKOUT — BACKEND API
   Deployed as an Apps Script Web App. The frontend (hosted separately on
   GitHub Pages) talks to this file entirely over HTTP as a JSON API —
   there is no more HtmlService/google.script.run in this project.

   Deploy: Extensions > Apps Script > Deploy > New deployment > Web app
           Execute as: Me
           Who has access: Anyone
   Copy the resulting /exec URL into API_BASE_URL in the frontend's
   index.html.
   ===================================================================== */

// ---------------------------------------------------------------------
// PROFILE CONFIGURATION
// Your Profiles sheet only stores id/name/active - it has no columns for
// goals, body stats, or owned equipment. Rather than force a schema change,
// those live here as plain constants you can edit any time. The plan
// generator (generateWeeklyPlan) reads from this object.
// ---------------------------------------------------------------------
const PROFILE_CONFIG = {
  M: {
    goals: ["fat_loss_belly", "arm_strength", "chest", "shoulders"],
    focusMuscleGroups: ["Chest", "Shoulders", "Back", "Arms", "Core", "Full Body", "Cardio"],
    stats: { heightFt: 6, weightKg: 80, age: 36, activityNote: "Sitting job, works from home" },
    weeklyTemplate: [
      { day: "Monday",    workoutName: "Push (Chest/Shoulders)", type: "Push",   targetGroups: ["Chest", "Shoulders", "Arms"] },
      { day: "Tuesday",   workoutName: "Pull (Back/Arms)",       type: "Pull",   targetGroups: ["Back", "Arms"] },
      { day: "Wednesday", workoutName: "Core & Cardio",          type: "Core",   targetGroups: ["Core", "Cardio"] },
      { day: "Thursday",  workoutName: "Rest",                   type: "Rest",   targetGroups: [] },
      { day: "Friday",    workoutName: "Push (Chest/Shoulders)", type: "Push",   targetGroups: ["Chest", "Shoulders", "Arms"] },
      { day: "Saturday",  workoutName: "Pull (Back/Arms)",       type: "Pull",   targetGroups: ["Back", "Arms"] },
      { day: "Sunday",    workoutName: "Rest",                   type: "Rest",   targetGroups: [] }
    ]
  },
  F: {
    goals: ["fat_loss_belly", "thigh_tone", "posture", "shoulders", "stamina"],
    focusMuscleGroups: ["Legs", "Glutes", "Shoulders", "Back", "Core", "Cardio"],
    stats: { heightFt: 5.4, weightKg: 69, age: 39, activityNote: "Standing job (teacher). Trying to conceive; has PCOD." },
    // Note: this app is not a medical tool. Any exercise adjustments related
    // to PCOD or trying to conceive should be confirmed with her doctor -
    // this template just avoids stacking high-intensity days back to back.
    weeklyTemplate: [
      { day: "Monday",    workoutName: "Legs & Glutes",       type: "Legs",  targetGroups: ["Legs", "Glutes"] },
      { day: "Tuesday",   workoutName: "Posture & Shoulders",  type: "Upper", targetGroups: ["Shoulders", "Back"] },
      { day: "Wednesday", workoutName: "Stamina / Cardio",     type: "Cardio",targetGroups: ["Cardio", "Core"] },
      { day: "Thursday",  workoutName: "Rest",                 type: "Rest",  targetGroups: [] },
      { day: "Friday",    workoutName: "Legs & Glutes",        type: "Legs",  targetGroups: ["Legs", "Glutes"] },
      { day: "Saturday",  workoutName: "Posture & Core",       type: "Upper", targetGroups: ["Shoulders", "Back", "Core"] },
      { day: "Sunday",    workoutName: "Rest",                 type: "Rest",  targetGroups: [] }
    ]
  }
};

// Equipment you actually own. Used to filter which exercises the plan
// generator is allowed to pick. Matching is a case-insensitive substring
// check against the Exercises sheet's Equipment column.
const OWNED_EQUIPMENT_KEYWORDS = [
  "dumbbell", "pull-up", "pullup", "pull up", "bar",
  "ab roller", "roller", "band", "resistance band",
  "bodyweight", "none", "mat"
];

const EXERCISES_PER_WORKOUT_DAY = 5;


// ---------------------------------------------------------------------
// ENTRY POINTS
// ---------------------------------------------------------------------

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (!params.action) {
    // Fallback: opening the /exec URL directly in a browser with no
    // ?action= shows a small status page instead of a blank/JSON page.
    return HtmlService.createHtmlOutput(
      "<p>My Home Workout API is running. This URL is meant to be called " +
      "by the frontend app, not opened directly.</p>"
    );
  }

  return handleRequest(params.action, params);
}

function doPost(e) {
  let body = {};

  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return jsonOutput({ ok: false, error: "Invalid request body." });
  }

  return handleRequest(body.action, body);
}

function handleRequest(action, params) {
  try {
    const data = routeAction(action, params || {});
    return jsonOutput({ ok: true, data: data });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function routeAction(action, p) {
  switch (action) {
    case "getProfiles":            return getProfiles();
    case "getTodayWorkout":        return getTodayWorkout(p.profileId);
    case "getWorkoutExercises":    return getWorkoutExercises(p.scheduleId);
    case "getWorkoutModeData":     return getWorkoutModeData(p.scheduleId);
    case "startWorkoutSession":    return startWorkoutSession(p.profileId, p.scheduleId);
    case "logExerciseSet":         return logExerciseSet(p.sessionId, p.exerciseId, p.setNumber, p.setsPlanned, p.plannedTarget, p.completedValue, p.completed);
    case "completeWorkoutSession": return completeWorkoutSession(p.sessionId);
    case "logProgress":            return logProgress(p.profileId, p.weightKg, p.waistCm);
    case "getProgressHistory":     return getProgressHistory(p.profileId);
    case "getWorkoutHistory":      return getWorkoutHistory(p.profileId, p.limit);
    case "getPersonalRecords":     return getPersonalRecords(p.profileId);
    case "getDashboardSummary":    return getDashboardSummary(p.profileId);
    case "generateWeeklyPlan":     return generateWeeklyPlan(p.profileId);
    default:
      throw new Error("Unknown action: " + action);
  }
}


// ---------------------------------------------------------------------
// PROFILES  (unchanged logic, now also returns config for the Settings screen)
// ---------------------------------------------------------------------

function getProfiles() {
  const sheet = mustGetSheet("Profiles");
  const data = sheet.getDataRange().getValues();
  const profiles = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "") continue;

    const active = data[i][3] === true || String(data[i][3]).toUpperCase() === "TRUE";
    if (!active) continue;

    const profileId = data[i][0];
    const config = PROFILE_CONFIG[profileId] || {};

    profiles.push({
      profileId: profileId,
      profileName: data[i][1],
      displayName: data[i][2],
      active: active,
      goals: config.goals || [],
      stats: config.stats || {}
    });
  }

  return profiles;
}


// ---------------------------------------------------------------------
// TODAY'S WORKOUT / EXERCISES  (unchanged from the original)
// ---------------------------------------------------------------------

function getTodayWorkout(profileId) {
  const sheet = mustGetSheet("Weekly_Schedule");
  const data = sheet.getDataRange().getValues();
  const today = new Date();

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayName = dayNames[today.getDay()];

  for (let i = 1; i < data.length; i++) {
    const rowProfileId = data[i][1];
    const rowDay = data[i][2];
    const active = data[i][5] === true || String(data[i][5]).toUpperCase() === "TRUE";

    if (rowProfileId === profileId && rowDay === todayName && active) {
      return {
        scheduleId: data[i][0],
        profileId: data[i][1],
        day: data[i][2],
        workoutName: data[i][3],
        workoutType: data[i][4]
      };
    }
  }

  return null;
}

function getWorkoutExercises(scheduleId) {
  const plansSheet = mustGetSheet("Workout_Plans");
  const exercisesSheet = mustGetSheet("Exercises");

  const plansData = plansSheet.getDataRange().getValues();
  const exercisesData = exercisesSheet.getDataRange().getValues();

  const exerciseMap = {};

  for (let j = 1; j < exercisesData.length; j++) {
    const exerciseId = exercisesData[j][0];
    if (!exerciseId) continue;

    const active = exercisesData[j][12] === true || String(exercisesData[j][12]).toUpperCase() === "TRUE";
    if (!active) continue;

    exerciseMap[exerciseId] = {
      exerciseId: exerciseId,
      exerciseName: exercisesData[j][1],
      muscleGroup: exercisesData[j][2],
      exerciseType: exercisesData[j][3],
      equipment: exercisesData[j][4],
      defaultSets: exercisesData[j][5],
      defaultReps: exercisesData[j][6],
      defaultRestSec: exercisesData[j][7],
      instructions: exercisesData[j][8],
      beginnerModification: exercisesData[j][9],
      commonMistakes: exercisesData[j][10],
      videoMediaUrl: exercisesData[j][11]
    };
  }

  const exercises = [];

  for (let i = 1; i < plansData.length; i++) {
    if (plansData[i][1] !== scheduleId) continue;

    const exercise = exerciseMap[plansData[i][2]];
    if (!exercise) continue;

    exercises.push({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      muscleGroup: exercise.muscleGroup,
      exerciseType: exercise.exerciseType,
      equipment: exercise.equipment,
      exerciseOrder: Number(plansData[i][3]) || 0,
      sets: plansData[i][4],
      reps: plansData[i][5],
      restSec: plansData[i][6],
      notes: plansData[i][7],
      instructions: exercise.instructions,
      beginnerModification: exercise.beginnerModification,
      commonMistakes: exercise.commonMistakes,
      videoMediaUrl: exercise.videoMediaUrl
    });
  }

  exercises.sort(function (a, b) { return a.exerciseOrder - b.exerciseOrder; });
  return exercises;
}

function getWorkoutModeData(scheduleId) {
  return { scheduleId: scheduleId, exercises: getWorkoutExercises(scheduleId) || [] };
}


// ---------------------------------------------------------------------
// SESSIONS / SET LOGGING  (unchanged logic from the original file)
// ---------------------------------------------------------------------

function startWorkoutSession(profileId, scheduleId) {
  const sessionsSheet = mustGetSheet("Workout_Sessions");
  const scheduleSheet = mustGetSheet("Weekly_Schedule");

  if (!profileId || !scheduleId) throw new Error("Profile ID and Schedule ID are required.");

  const scheduleData = scheduleSheet.getDataRange().getValues();
  let validSchedule = false;
  for (let i = 1; i < scheduleData.length; i++) {
    const id = String(scheduleData[i][0] || "").trim();
    const pid = String(scheduleData[i][1] || "").trim();
    const active = scheduleData[i][5] === true || String(scheduleData[i][5]).toUpperCase() === "TRUE";
    if (id === String(scheduleId).trim() && pid === String(profileId).trim() && active) {
      validSchedule = true;
      break;
    }
  }
  if (!validSchedule) throw new Error("The selected workout schedule is not active or does not belong to this profile.");

  const now = new Date();
  const timeZone = Session.getScriptTimeZone() || SpreadsheetApp.getActive().getSpreadsheetTimeZone() || "Asia/Kolkata";
  const todayKey = Utilities.formatDate(now, timeZone, "yyyy-MM-dd");
  const data = sessionsSheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    const rowProfileId = String(data[i][1] || "").trim();
    const rowScheduleId = String(data[i][2] || "").trim();
    const rowStatus = String(data[i][7] || "").trim().toLowerCase();
    const rawStart = data[i][4];

    if (rowProfileId !== String(profileId).trim() || rowScheduleId !== String(scheduleId).trim() ||
        rowStatus !== "started" || !rawStart) continue;

    const parsedStart = rawStart instanceof Date ? rawStart : new Date(rawStart);
    if (!isNaN(parsedStart.getTime())) {
      const rowDateKey = Utilities.formatDate(parsedStart, timeZone, "yyyy-MM-dd");
      if (rowDateKey === todayKey) {
        return {
          sessionId: String(data[i][0]), profileId: String(profileId), scheduleId: String(scheduleId),
          status: "Started", startTime: parsedStart.toISOString(), resumed: true
        };
      }
    }
  }

  const sessionId = "SES_" + Utilities.formatDate(now, timeZone, "yyyyMMdd_HHmmss") + "_" +
    now.getMilliseconds() + "_" + Math.floor(Math.random() * 10000);
  const workoutDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  sessionsSheet.appendRow([sessionId, String(profileId), String(scheduleId), workoutDate, now, "", "", "Started", ""]);
  SpreadsheetApp.flush();

  return {
    sessionId: sessionId, profileId: String(profileId), scheduleId: String(scheduleId),
    status: "Started", startTime: now.toISOString(), resumed: false
  };
}

function logExerciseSet(sessionId, exerciseId, setNumber, setsPlanned, plannedTarget, completedValue, completed) {
  const sheet = mustGetSheet("Exercise_Log");
  if (!sessionId || !exerciseId) throw new Error("Session ID and Exercise ID are required.");

  const logId = "LOG_" + sessionId + "_" + exerciseId + "_S" + setNumber;
  sheet.appendRow([logId, sessionId, exerciseId, setsPlanned, 1, plannedTarget, completedValue, completed === true || completed === "true"]);

  return { logId: logId, sessionId: sessionId, exerciseId: exerciseId, setNumber: setNumber, completed: true };
}

function completeWorkoutSession(sessionId) {
  const sessionsSheet = mustGetSheet("Workout_Sessions");
  const progressSheet = mustGetSheet("Progress");
  if (!sessionId) throw new Error("Session ID is required.");

  const data = sessionsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(sessionId)) continue;

    const profileId = data[i][1];
    const scheduleId = data[i][2];
    const startTime = data[i][4];
    const existingStatus = String(data[i][7] || "");

    if (!(startTime instanceof Date)) throw new Error("Session start time is invalid.");

    if (existingStatus.toLowerCase() === "completed") {
      return {
        sessionId: sessionId,
        endTime: data[i][5] instanceof Date ? data[i][5].toISOString() : "",
        durationMin: Number(data[i][6]) || 0,
        status: "Completed", progressRecorded: false
      };
    }

    const endTime = new Date();
    const durationMin = Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 60000));

    sessionsSheet.getRange(i + 1, 6).setValue(endTime);
    sessionsSheet.getRange(i + 1, 7).setValue(durationMin);
    sessionsSheet.getRange(i + 1, 8).setValue("Completed");

    let progressRecorded = false;
    const progressData = progressSheet.getDataRange().getValues();
    const todayKey = Utilities.formatDate(endTime, Session.getScriptTimeZone(), "yyyy-MM-dd");
    let alreadyRecorded = false;

    for (let r = 1; r < progressData.length; r++) {
      const existingProfile = String(progressData[r][1] || "");
      const existingDate = progressData[r][2];
      if (!(existingDate instanceof Date)) continue;

      const existingDateKey = Utilities.formatDate(existingDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
      if (existingProfile === String(profileId) && existingDateKey === todayKey &&
          String(progressData[r][5] || "").toLowerCase().indexOf("workout completed") !== -1) {
        alreadyRecorded = true;
        break;
      }
    }

    if (!alreadyRecorded) {
      const progressId = "PROG_" + Utilities.formatDate(endTime, Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") + "_" + Math.floor(Math.random() * 1000);
      progressSheet.appendRow([
        progressId, profileId,
        new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate()),
        "", "",
        "Workout completed | Session: " + sessionId + " | Schedule: " + scheduleId + " | Duration: " + durationMin + " min"
      ]);
      progressRecorded = true;
    }

    return { sessionId: sessionId, endTime: endTime.toISOString(), durationMin: durationMin, status: "Completed", progressRecorded: progressRecorded };
  }

  throw new Error("Workout session not found: " + sessionId);
}


// ---------------------------------------------------------------------
// PROGRESS: WEIGHT / WAIST LOGGING  (new)
// ---------------------------------------------------------------------

function logProgress(profileId, weightKg, waistCm) {
  if (!profileId) throw new Error("Profile ID is required.");
  if (!weightKg && !waistCm) throw new Error("Enter a weight, a waist measurement, or both.");

  const sheet = mustGetSheet("Progress");
  const now = new Date();
  const progressId = "PROG_" + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") + "_" + Math.floor(Math.random() * 1000);

  sheet.appendRow([
    progressId, profileId,
    new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    weightKg ? Number(weightKg) : "",
    waistCm ? Number(waistCm) : "",
    "Manual log"
  ]);

  return { progressId: progressId, profileId: profileId, weightKg: weightKg || null, waistCm: waistCm || null };
}

function getProgressHistory(profileId) {
  const sheet = mustGetSheet("Progress");
  const data = sheet.getDataRange().getValues();
  const entries = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(profileId)) continue;

    const weight = data[i][3];
    const waist = data[i][4];
    if (weight === "" && waist === "") continue; // skip workout-completion rows

    const date = data[i][2] instanceof Date ? data[i][2] : new Date(data[i][2]);
    if (isNaN(date.getTime())) continue;

    entries.push({
      date: Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      weightKg: weight === "" ? null : Number(weight),
      waistCm: waist === "" ? null : Number(waist)
    });
  }

  entries.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return entries;
}


// ---------------------------------------------------------------------
// WORKOUT HISTORY  (new)
// ---------------------------------------------------------------------

function getWorkoutHistory(profileId, limit) {
  const sessionsSheet = mustGetSheet("Workout_Sessions");
  const scheduleSheet = mustGetSheet("Weekly_Schedule");

  const scheduleData = scheduleSheet.getDataRange().getValues();
  const scheduleNames = {};
  for (let i = 1; i < scheduleData.length; i++) {
    scheduleNames[scheduleData[i][0]] = scheduleData[i][3];
  }

  const data = sessionsSheet.getDataRange().getValues();
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(profileId)) continue;
    if (String(data[i][7] || "").toLowerCase() !== "completed") continue;

    const date = data[i][3] instanceof Date ? data[i][3] : new Date(data[i][3]);

    rows.push({
      sessionId: data[i][0],
      scheduleId: data[i][2],
      workoutName: scheduleNames[data[i][2]] || "Workout",
      date: isNaN(date.getTime()) ? null : Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      durationMin: Number(data[i][6]) || 0
    });
  }

  rows.sort(function (a, b) { return (a.date < b.date) ? 1 : -1; });
  return rows.slice(0, Number(limit) || 20);
}


// ---------------------------------------------------------------------
// PERSONAL RECORDS  (new)
// Best value logged per exercise: for rep-based exercises, the highest
// completed-reps figure ever logged; for time-based, the longest hold.
// ---------------------------------------------------------------------

function getPersonalRecords(profileId) {
  const sessionsSheet = mustGetSheet("Workout_Sessions");
  const logSheet = mustGetSheet("Exercise_Log");
  const exercisesSheet = mustGetSheet("Exercises");

  const sessionProfile = {};
  const sessionsData = sessionsSheet.getDataRange().getValues();
  for (let i = 1; i < sessionsData.length; i++) {
    sessionProfile[sessionsData[i][0]] = String(sessionsData[i][1]);
  }

  const exerciseNames = {};
  const exercisesData = exercisesSheet.getDataRange().getValues();
  for (let i = 1; i < exercisesData.length; i++) {
    exerciseNames[exercisesData[i][0]] = exercisesData[i][1];
  }

  const best = {}; // exerciseId -> { value, unit }
  const logData = logSheet.getDataRange().getValues();

  for (let i = 1; i < logData.length; i++) {
    const sessionId = logData[i][1];
    const exerciseId = logData[i][2];
    if (sessionProfile[sessionId] !== String(profileId)) continue;

    const completedRaw = String(logData[i][6] || "");
    const numeric = parseFloat(completedRaw.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(numeric)) continue;

    const unit = /sec|second|min/i.test(completedRaw) ? "sec" : "reps";

    if (!best[exerciseId] || numeric > best[exerciseId].value) {
      best[exerciseId] = { value: numeric, unit: unit };
    }
  }

  const records = Object.keys(best).map(function (exerciseId) {
    return {
      exerciseId: exerciseId,
      exerciseName: exerciseNames[exerciseId] || exerciseId,
      value: best[exerciseId].value,
      unit: best[exerciseId].unit
    };
  });

  records.sort(function (a, b) { return a.exerciseName.localeCompare(b.exerciseName); });
  return records;
}


// ---------------------------------------------------------------------
// DASHBOARD SUMMARY  (new)
// ---------------------------------------------------------------------

function getDashboardSummary(profileId) {
  const history = getWorkoutHistory(profileId, 200);
  const progress = getProgressHistory(profileId);
  const records = getPersonalRecords(profileId);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const sessionsThisWeek = history.filter(function (h) {
    return h.date && new Date(h.date) >= weekAgo;
  }).length;

  // Weekly session counts for the last 6 weeks, oldest first.
  const weeklyBuckets = [];
  for (let w = 5; w >= 0; w--) {
    const start = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    const count = history.filter(function (h) {
      if (!h.date) return false;
      const d = new Date(h.date);
      return d >= start && d < end;
    }).length;
    weeklyBuckets.push({ weekLabel: "W-" + w, count: count });
  }

  const weightSeries = progress.filter(function (p) { return p.weightKg !== null; });
  const waistSeries = progress.filter(function (p) { return p.waistCm !== null; });

  return {
    totalSessionsCompleted: history.length,
    sessionsThisWeek: sessionsThisWeek,
    weeklySessionCounts: weeklyBuckets,
    weightSeries: weightSeries,
    waistSeries: waistSeries,
    latestWeightKg: weightSeries.length ? weightSeries[weightSeries.length - 1].weightKg : null,
    latestWaistCm: waistSeries.length ? waistSeries[waistSeries.length - 1].waistCm : null,
    personalRecords: records
  };
}


// ---------------------------------------------------------------------
// INTELLIGENT WEEKLY PLAN GENERATOR  (new)
// Builds a fresh Weekly_Schedule + Workout_Plans for a profile from the
// PROFILE_CONFIG template above, filtered to owned equipment. Old rows are
// soft-deactivated (Active = FALSE) rather than deleted, so workout
// history stays joinable to its original schedule/plan rows.
// ---------------------------------------------------------------------

function generateWeeklyPlan(profileId) {
  const config = PROFILE_CONFIG[profileId];
  if (!config) throw new Error("No plan template configured for profile: " + profileId);

  const exercisesSheet = mustGetSheet("Exercises");
  const scheduleSheet = mustGetSheet("Weekly_Schedule");
  const plansSheet = mustGetSheet("Workout_Plans");

  const exercisesData = exercisesSheet.getDataRange().getValues();
  const pool = [];
  for (let i = 1; i < exercisesData.length; i++) {
    const row = exercisesData[i];
    if (!row[0]) continue;
    const active = row[12] === true || String(row[12]).toUpperCase() === "TRUE";
    if (!active) continue;
    if (!equipmentIsOwned(row[4])) continue;

    pool.push({
      exerciseId: row[0], exerciseName: row[1], muscleGroup: row[2], exerciseType: row[3],
      equipment: row[4], defaultSets: row[5], defaultReps: row[6], defaultRestSec: row[7]
    });
  }

  if (pool.length === 0) {
    throw new Error("No active exercises match your owned equipment. Check the Equipment column in the Exercises sheet.");
  }

  // Deactivate this profile's current schedule rows (soft delete).
  const scheduleData = scheduleSheet.getDataRange().getValues();
  for (let i = 1; i < scheduleData.length; i++) {
    if (String(scheduleData[i][1]) === String(profileId)) {
      scheduleSheet.getRange(i + 1, 6).setValue(false); // Active column
    }
  }

  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
  const usedThisWeek = {}; // exerciseId -> count, to spread variety across days

  const generatedDays = [];

  config.weeklyTemplate.forEach(function (day, dayIndex) {
    if (day.type === "Rest" || day.targetGroups.length === 0) {
      const scheduleId = profileId + "S_" + stamp + "_" + dayIndex;
      scheduleSheet.appendRow([scheduleId, profileId, day.day, "Rest Day", "Rest", false]);
      generatedDays.push({ day: day.day, workoutName: "Rest Day", exercises: [] });
      return;
    }

    const scheduleId = profileId + "S_" + stamp + "_" + dayIndex;
    scheduleSheet.appendRow([scheduleId, profileId, day.day, day.workoutName, day.type, true]);

    const candidates = pool
      .filter(function (ex) { return day.targetGroups.indexOf(ex.muscleGroup) !== -1; })
      .sort(function (a, b) { return (usedThisWeek[a.exerciseId] || 0) - (usedThisWeek[b.exerciseId] || 0); });

    const chosen = candidates.slice(0, EXERCISES_PER_WORKOUT_DAY);
    chosen.forEach(function (ex) { usedThisWeek[ex.exerciseId] = (usedThisWeek[ex.exerciseId] || 0) + 1; });

    chosen.forEach(function (ex, order) {
      plansSheet.appendRow([
        scheduleId + "_P" + order, scheduleId, ex.exerciseId, order + 1,
        ex.defaultSets, ex.defaultReps, ex.defaultRestSec, "Auto-generated"
      ]);
    });

    generatedDays.push({ day: day.day, workoutName: day.workoutName, exercises: chosen.map(function (e) { return e.exerciseName; }) });
  });

  SpreadsheetApp.flush();

  return { profileId: profileId, generatedAt: now.toISOString(), days: generatedDays };
}

function equipmentIsOwned(equipmentField) {
  const text = String(equipmentField || "").toLowerCase();
  if (!text.trim()) return true; // blank equipment = assume bodyweight
  return OWNED_EQUIPMENT_KEYWORDS.some(function (kw) { return text.indexOf(kw) !== -1; });
}


// ---------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------

function mustGetSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(name + " sheet not found.");
  return sheet;
}
