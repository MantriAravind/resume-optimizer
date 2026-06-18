const button = document.querySelector("#optimizeBtn");
const resumeInput = document.querySelector("#resumeInput");
const jobInput = document.querySelector("#jobInput");
const resultsArea = document.querySelector("#resultsArea");

button.addEventListener("click", function () {
  const resumeText = resumeInput.value;
  const jobText = jobInput.value;

  if (resumeText.trim() === "" || jobText.trim() === "") {
    resultsArea.textContent = "Please fill in both your resume and the job description.";
    return;
  }

  resultsArea.textContent = "Resume length: " + resumeText.length + " characters. Job description length: " + jobText.length + " characters.";
});