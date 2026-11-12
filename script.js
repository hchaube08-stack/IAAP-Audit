(() => {
  'use strict';

  const projectCard = document.querySelector('#project-card');
  const gridButton = document.querySelector('#grid-view');
  const listButton = document.querySelector('#list-view');
  const milestoneSelect = document.querySelector('#milestone-select');
  const iterationField = document.querySelector('#iteration-field');
  const iterationSelect = document.querySelector('#iteration-select');
  const selectionSummary = document.querySelector('#selection-summary');

  function setView(view) {
    const isGrid = view === 'grid';
    projectCard.classList.toggle('grid-layout', isGrid);
    projectCard.classList.toggle('list-layout', !isGrid);
    gridButton.classList.toggle('is-active', isGrid);
    listButton.classList.toggle('is-active', !isGrid);
    gridButton.setAttribute('aria-pressed', String(isGrid));
    listButton.setAttribute('aria-pressed', String(!isGrid));
    try {
      localStorage.setItem('tmb-project-view', view);
    } catch {
      // The view switch still works when browser storage is unavailable.
    }
  }

  function updateMilestone() {
    const roundTwo = milestoneSelect.value === 'round-2';
    iterationField.hidden = !roundTwo;
    selectionSummary.textContent = roundTwo
      ? `Selected: Round 2 — ${iterationSelect.options[iterationSelect.selectedIndex].text}`
      : 'Selected: Round 1';
  }

  gridButton.addEventListener('click', () => setView('grid'));
  listButton.addEventListener('click', () => setView('list'));
  milestoneSelect.addEventListener('change', updateMilestone);
  iterationSelect.addEventListener('change', updateMilestone);

  let savedView = 'grid';
  try {
    savedView = localStorage.getItem('tmb-project-view') === 'list' ? 'list' : 'grid';
  } catch {
    // Use grid view when browser storage is unavailable.
  }
  setView(savedView);
  updateMilestone();
})();
