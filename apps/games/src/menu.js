// @ts-check
// Games menu: choose the profile once for every game.
import { loadChoice } from "@heart-hands/core";
import { $, mountProfilePicker } from "./common.js";

const NOTES = {
  standard: "The games as designed: normal target sizes and movement.",
  gentle: "Bigger targets, smaller movements, steadier cursor, fewer repetitions and a slow lift instead of a fast flick. Good for reduced range of motion, slower movement or tremor.",
};
mountProfilePicker(/** @type {HTMLSelectElement} */ ($("profileSel")));
$("profileNote").textContent = NOTES[/** @type {keyof typeof NOTES} */ (loadChoice().profileId)] ?? "";
