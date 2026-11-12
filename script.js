(() => {
  'use strict';
  const DB_NAME = 'project-hub-local';
  const DB_VERSION = 3;
  const $ = (selector, root = document) => root.querySelector(selector);
  const projectsView = $('#projects-view');
  const projectView = $('#project-view');
  const projectList = $('#project-list');
  const notice = $('#notice');
  const projectForm = $('#project-form');
  let db = null;
  let activeProjectId = null;
  let pendingSubmoduleModuleId = null;
  let textEditField = 'details';
  let fallbackMode = false;
  let fallbackProjects = [];
  let activeProjectCache = null;

  function newId() { return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.hidden = false;
    notice.classList.toggle('notice-error', isError);
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => { notice.hidden = true; }, 7000);
  }
  function readForm(form) { return Object.fromEntries(new FormData(form).entries()); }
  function field(form, name) { return form.elements.namedItem(name); }
  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  function closeDialog(dialog) {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }
  function formatDate(value) {
    if (!value) return '';
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(date).replace(/ /g, '-');
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }
  function statusLabel(status) { return ({ planning: 'Planning', 'in-progress': 'In progress', 'on-hold': 'On hold', complete: 'Complete' })[status] || 'Planning'; }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Browser storage request failed'));
    });
  }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB is unavailable in this browser context.')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('files')) {
          const files = database.createObjectStore('files', { keyPath: 'id' });
          files.createIndex('projectId', 'projectId', { unique: false });
          files.createIndex('taskId', 'taskId', { unique: false });
        } else {
          const files = request.transaction.objectStore('files');
          if (!files.indexNames.contains('projectId')) files.createIndex('projectId', 'projectId', { unique: false });
          if (!files.indexNames.contains('taskId')) files.createIndex('taskId', 'taskId', { unique: false });
        }
        if (!database.objectStoreNames.contains('tasks')) {
          const tasks = database.createObjectStore('tasks', { keyPath: 'id' });
          tasks.createIndex('projectId', 'projectId', { unique: false });
        } else {
          const tasks = request.transaction.objectStore('tasks');
          if (!tasks.indexNames.contains('projectId')) tasks.createIndex('projectId', 'projectId', { unique: false });
        }
      };
      request.onsuccess = () => { db = request.result; db.onversionchange = () => db.close(); resolve(db); };
      request.onerror = () => reject(request.error || new Error('Could not open browser storage.'));
      request.onblocked = () => reject(new Error('Storage upgrade is blocked by another open app tab. Close other tabs and reload.'));
    });
  }
  function txStore(name, mode = 'readonly') {
    if (!db) throw new Error('Project storage has not finished starting. Wait a moment and try again.');
    return db.transaction(name, mode).objectStore(name);
  }
  function fallbackRead() {
    try { fallbackProjects = JSON.parse(localStorage.getItem('project-hub-projects') || '[]'); }
    catch { fallbackProjects = []; }
  }
  async function getProjects() {
    if (fallbackMode) return fallbackProjects.slice();
    return requestResult(txStore('projects').getAll());
  }
  async function getProject(id = activeProjectId) {
    if (fallbackMode) return fallbackProjects.find((project) => project.id === id) || null;
    return requestResult(txStore('projects').get(id));
  }
  async function saveProject(project) {
    if (fallbackMode) {
      const index = fallbackProjects.findIndex((entry) => entry.id === project.id);
      if (index >= 0) fallbackProjects[index] = project; else fallbackProjects.push(project);
      try { localStorage.setItem('project-hub-projects', JSON.stringify(fallbackProjects)); }
      catch { throw new Error('Browser storage is full or disabled. Enable site storage and try again.'); }
      return project;
    }
    return requestResult(txStore('projects', 'readwrite').put(project));
  }
  async function getTasks(projectId = activeProjectId) {
    if (fallbackMode) return (await getProject(projectId))?.tasks || [];
    return requestResult(txStore('tasks').index('projectId').getAll(projectId));
  }
  async function saveTask(task) {
    if (fallbackMode) {
      const project = await getProject(task.projectId);
      if (!project) throw new Error('Project not found.');
      project.tasks ||= [];
      const index = project.tasks.findIndex((entry) => entry.id === task.id);
      if (index >= 0) project.tasks[index] = task; else project.tasks.push(task);
      project.updatedAt = Date.now();
      return saveProject(project);
    }
    return requestResult(txStore('tasks', 'readwrite').put(task));
  }
  async function deleteTask(taskId) {
    if (fallbackMode) {
      const project = await getProject();
      project.tasks = (project.tasks || []).filter((task) => task.id !== taskId);
      project.updatedAt = Date.now();
      return saveProject(project);
    }
    return requestResult(txStore('tasks', 'readwrite').delete(taskId));
  }
  async function renderProjects() {
    const all = (await getProjects()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const query = $('#project-search').value.trim().toLocaleLowerCase();
    const status = $('#status-filter').value;
    const projects = all.filter((project) => `${project.name} ${project.owner || ''}`.toLocaleLowerCase().includes(query) && (status === 'all' || (project.status || 'planning') === status));
    projectList.replaceChildren();
    $('#empty-projects').hidden = all.length !== 0;
    $('#empty-filter-results').hidden = all.length === 0 || projects.length !== 0;
    for (const project of projects) {
      const tasks = await getTasks(project.id);
      const done = tasks.filter((task) => task.status === 'complete').length;
      const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      const item = document.createElement('li');
      const link = document.createElement('a'); link.className = 'project-card'; link.href = `#project-${encodeURIComponent(project.id)}`;
      const top = document.createElement('div'); top.className = 'project-card-top';
      const title = document.createElement('h2'); title.textContent = project.name;
      const badge = document.createElement('span'); badge.className = `status-badge status-${project.status || 'planning'}`; badge.textContent = statusLabel(project.status);
      top.append(title, badge);
      const owner = document.createElement('p'); owner.className = 'project-card-owner'; owner.textContent = project.owner ? `Owner: ${project.owner}` : 'Owner not assigned';
      const dates = document.createElement('p'); dates.className = 'project-card-dates';
      dates.textContent = project.startDate || project.endDate ? `${formatDate(project.startDate) || 'Start date not set'}${project.endDate ? ` – ${formatDate(project.endDate)}` : ''}` : 'Dates not set';
      const progressLine = document.createElement('div'); progressLine.className = 'progress-line';
      const progressText = document.createElement('span'); progressText.textContent = `${percent}% complete`;
      const taskText = document.createElement('span'); taskText.textContent = `${done}/${tasks.length} tasks`;
      progressLine.append(progressText, taskText);
      const progress = document.createElement('div'); progress.className = 'project-progress'; progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', `${project.name} task completion`); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100'); progress.setAttribute('aria-valuenow', String(percent));
      const fill = document.createElement('span'); fill.style.width = `${percent}%`; progress.append(fill);
      link.append(top, owner, dates, progressLine, progress);
      link.addEventListener('click', async (event) => { event.preventDefault(); await selectProject(project.id); });
      item.append(link); projectList.append(item);
    }
  }
  async function selectProject(projectId) {
    const project = await getProject(projectId);
    if (!project) { showNotice('Project not found in this browser. Create it here or import a backup.', true); return; }
    activeProjectId = projectId; activeProjectCache = project;
    projectsView.hidden = true; projectView.hidden = false;
    history.replaceState(null, '', `${location.pathname}${location.search}#project-${encodeURIComponent(projectId)}`);
    renderProjectDetails(project); await renderTasks(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderProjectDetails(project) {
    activeProjectCache = project;
    $('#project-title').textContent = project.name;
    const badge = $('#project-status'); badge.textContent = statusLabel(project.status); badge.className = `status-badge status-${project.status || 'planning'}`;
    $('#project-dates').textContent = [project.startDate && `Start: ${formatDate(project.startDate)}`, project.endDate && `End: ${formatDate(project.endDate)}`].filter(Boolean).join(' · ') || 'No project dates set';
    renderTeam(project); renderModules(project); renderLinks(project); renderMilestones(project);
    for (const [fieldName, emptyId, elementId] of [['details', 'empty-details', 'details-content'], ['defectReport', 'empty-defects', 'defects-content']]) {
      const value = project[fieldName] || ''; const element = $(`#${elementId}`); element.textContent = value; element.hidden = !value; $(`#${emptyId}`).hidden = Boolean(value);
    }
  }
  function action(label, className, handler, ariaLabel = '') {
    const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = label;
    if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', handler); return button;
  }
  function renderTeam(project) {
    const list = $('#team-list'); list.replaceChildren(); const people = project.team || []; $('#empty-team').hidden = people.length > 0;
    people.forEach((person) => {
      const item = document.createElement('li'); item.className = 'chip'; const name = document.createElement('span'); name.textContent = person.name;
      item.append(name, action('Remove', 'mini-remove', () => updateProject((p) => { p.team = (p.team || []).filter((entry) => entry.id !== person.id); }), `Remove ${person.name}`)); list.append(item);
    });
  }
  function renderModules(project) {
    const list = $('#module-list'); list.replaceChildren(); const modules = project.modules || []; $('#empty-modules').hidden = modules.length > 0;
    modules.forEach((module) => {
      const item = document.createElement('li'); item.className = 'module-item'; const header = document.createElement('div'); header.className = 'module-header'; const name = document.createElement('h3'); name.textContent = module.name;
      const controls = document.createElement('div'); controls.className = 'inline-actions';
      controls.append(action('Add submodule', 'text-button', () => { pendingSubmoduleModuleId = module.id; $('#submodule-form').reset(); openDialog('submodule-dialog'); field($('#submodule-form'), 'name').focus(); }));
      controls.append(action('Remove', 'text-button danger-text', () => updateProject((p) => { p.modules = (p.modules || []).filter((entry) => entry.id !== module.id); })));
      header.append(name, controls); item.append(header); const subs = document.createElement('ul'); subs.className = 'submodule-list';
      (module.submodules || []).forEach((sub, index) => { const li = document.createElement('li'); const text = document.createElement('span'); text.textContent = sub; li.append(text, action('×', 'mini-remove', () => updateProject((p) => { const target = p.modules.find((entry) => entry.id === module.id); if (target) target.submodules.splice(index, 1); }), `Remove submodule ${sub}`)); subs.append(li); });
      if (!(module.submodules || []).length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No submodules yet.'; subs.append(li); }
      item.append(subs); list.append(item);
    });
  }
  function renderLinks(project) {
    const list = $('#link-list'); list.replaceChildren(); const links = project.links || []; $('#empty-links').hidden = links.length > 0;
    links.forEach((entry) => { const li = document.createElement('li'); li.className = 'resource-row'; const a = document.createElement('a'); a.href = safeUrl(entry.url) || '#'; a.textContent = entry.label; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a, action('Remove', 'mini-remove', () => updateProject((p) => { p.links = (p.links || []).filter((link) => link.id !== entry.id); }))); list.append(li); });
  }
  function renderMilestones(project) {
    const list = $('#milestone-list'); list.replaceChildren(); const milestones = project.milestones || []; $('#empty-milestones').hidden = milestones.length > 0;
    milestones.forEach((milestone, index) => {
      const li = document.createElement('li'); li.className = 'milestone-item'; const number = document.createElement('span'); number.className = 'milestone-number'; number.textContent = String(index + 1).padStart(2, '0');
      const main = document.createElement('div'); main.className = 'milestone-main'; const name = document.createElement('strong'); name.textContent = milestone.name; main.append(name);
      if (milestone.date) { const date = document.createElement('small'); date.textContent = formatDate(milestone.date); main.append(date); }
      li.append(number, main);
      if (milestone.url && safeUrl(milestone.url)) { const a = document.createElement('a'); a.href = safeUrl(milestone.url); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Open link'; li.append(a); } else li.append(document.createElement('span'));
      li.append(action('Remove', 'mini-remove', () => updateProject((p) => { p.milestones = (p.milestones || []).filter((entry) => entry.id !== milestone.id); }))); list.append(li);
    });
  }
  async function updateProject(mutator) {
    try { const project = await getProject(); if (!project) return; mutator(project); project.updatedAt = Date.now(); await saveProject(project); renderProjectDetails(project); await renderProjects(); }
    catch (error) { console.error(error); showNotice(`Could not save this update: ${error.message || 'storage error'}`, true); }
  }
  async function renderTasks() {
    const tasks = (await getTasks()).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    const list = $('#task-list'); list.replaceChildren(); $('#empty-tasks').hidden = tasks.length > 0;
    const done = tasks.filter((task) => task.status === 'complete').length; $('#task-summary').textContent = `${done} of ${tasks.length} complete`;
    tasks.forEach((task) => {
      const row = document.createElement('li'); row.className = 'task-row';
      const title = document.createElement('div'); title.className = 'task-row-title'; title.textContent = task.title;
      const owner = document.createElement('div'); owner.textContent = task.owner ? `Owner: ${task.owner}` : 'No owner';
      const date = document.createElement('div'); date.textContent = task.dueDate ? `Due: ${formatDate(task.dueDate)}` : 'No due date';
      const status = document.createElement('select'); status.setAttribute('aria-label', `Status for ${task.title}`);
      [['planning','To do'],['in-progress','In progress'],['complete','Complete']].forEach(([value,label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; status.append(option); });
      status.value = task.status || 'planning'; status.addEventListener('change', async () => { task.status = status.value; task.updatedAt = Date.now(); await saveTask(task); await renderTasks(); await renderProjects(); });
      const actions = document.createElement('div'); actions.className = 'task-row-actions';
      actions.append(action('Edit', 'text-button', () => openTaskEditor(task)));
      actions.append(action('Delete', 'text-button danger-text', async () => { if (!confirm(`Delete task “${task.title}”?`)) return; await deleteTask(task.id); await renderTasks(); await renderProjects(); showNotice('Task deleted.'); }));
      row.append(title, owner, date, status, actions); list.append(row);
    });
  }
  function openTaskEditor(task) {
    const form = $('#task-form'); form.dataset.editId = task?.id || ''; field(form, 'title').value = task?.title || ''; field(form, 'owner').value = task?.owner || ''; field(form, 'dueDate').value = task?.dueDate || ''; field(form, 'status').value = task?.status || 'planning';
    $('#task-dialog-title').textContent = task ? 'Edit task' : 'Create task'; $('#create-task-button').textContent = task ? 'Save task' : 'Create task'; openDialog('task-dialog'); field(form, 'title').focus();
  }
  function resetProjectForm(project = null) {
    projectForm.reset(); projectForm.dataset.editId = project?.id || '';
    field(projectForm, 'name').value = project?.name || ''; field(projectForm, 'owner').value = project?.owner || ''; field(projectForm, 'status').value = project?.status || 'planning'; field(projectForm, 'startDate').value = project?.startDate || ''; field(projectForm, 'endDate').value = project?.endDate || '';
    $('#project-dialog-title').textContent = project ? 'Edit project' : 'Create project'; $('button[type="submit"]', projectForm).textContent = project ? 'Save changes' : 'Create project';
  }

  $('#open-create-project').addEventListener('click', () => { resetProjectForm(); openDialog('project-dialog'); field(projectForm, 'name').focus(); });
  $('#edit-project').addEventListener('click', () => { resetProjectForm(activeProjectCache); openDialog('project-dialog'); field(projectForm, 'name').focus(); });
  projectForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('button[type="submit"]', projectForm); submit.disabled = true;
    try {
      const values = readForm(projectForm); const name = String(values.name || '').trim();
      if (!name) { field(projectForm, 'name').focus(); return; }
      if (values.startDate && values.endDate && values.endDate < values.startDate) { field(projectForm, 'endDate').setCustomValidity('End date must be on or after the start date.'); field(projectForm, 'endDate').reportValidity(); field(projectForm, 'endDate').setCustomValidity(''); return; }
      const editId = projectForm.dataset.editId; const existing = editId ? await getProject(editId) : null;
      const project = { ...(existing || {}), id: editId || newId(), name, owner: String(values.owner || '').trim(), status: values.status || 'planning', startDate: values.startDate || '', endDate: values.endDate || '', team: existing?.team || [], details: existing?.details || '', modules: existing?.modules || [], defectReport: existing?.defectReport || '', links: existing?.links || [], milestones: existing?.milestones || [], tasks: existing?.tasks || [], createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
      await saveProject(project); closeDialog($('#project-dialog')); await renderProjects();
      if (editId) { activeProjectCache = project; renderProjectDetails(project); showNotice('Project updated.'); }
      else { await selectProject(project.id); showNotice('Project created. Add tasks and project details.'); }
    } catch (error) { console.error('Create project failed:', error); showNotice(`Project could not be saved: ${error.message || 'check browser storage permissions and try again'}`, true); }
    finally { submit.disabled = false; }
  });
  $('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const values = readForm(form); const title = String(values.title || '').trim(); if (!title || !activeProjectId) return;
    const editId = form.dataset.editId; const old = editId ? (await getTasks()).find((task) => task.id === editId) : null;
    const task = { ...(old || {}), id: editId || newId(), projectId: activeProjectId, title, owner: String(values.owner || '').trim(), dueDate: values.dueDate || '', status: values.status || 'planning', createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() };
    try { await saveTask(task); closeDialog($('#task-dialog')); form.reset(); form.dataset.editId = ''; await renderTasks(); await renderProjects(); showNotice(editId ? 'Task updated.' : 'Task created.'); }
    catch (error) { showNotice(`Task could not be saved: ${error.message}`, true); }
  });
  function bindDialogForm(id, onSubmit) { const form = $(`#${id}`); form.addEventListener('submit', async (event) => { event.preventDefault(); try { await onSubmit(event, form); } catch (error) { console.error(error); showNotice(`Could not save: ${error.message || 'storage error'}`, true); } }); }
  $('#add-resource').addEventListener('click', () => { $('#resource-form').reset(); openDialog('resource-dialog'); field($('#resource-form'), 'name').focus(); });
  bindDialogForm('resource-form', async (event, form) => { const name = field(form, 'name').value.trim(); if (!name) return; await updateProject((p) => { p.team ||= []; p.team.push({ id: newId(), name }); }); closeDialog($('#resource-dialog')); form.reset(); showNotice('Team resource added.'); });
  function openTextEditor(which) { textEditField = which; const label = which === 'details' ? 'Project details' : 'Defect report'; $('#text-dialog-title').textContent = label; $('#text-field-label').childNodes[0].textContent = `${label} `; field($('#text-form'), 'text').value = activeProjectCache?.[which] || ''; openDialog('text-dialog'); }
  $('#edit-details').addEventListener('click', () => openTextEditor('details')); $('#edit-defects').addEventListener('click', () => openTextEditor('defectReport'));
  bindDialogForm('text-form', async (event, form) => { const value = field(form, 'text').value.trim(); await updateProject((p) => { p[textEditField] = value; }); closeDialog($('#text-dialog')); showNotice('Project information saved.'); });
  $('#add-module').addEventListener('click', () => { $('#module-form').reset(); openDialog('module-dialog'); field($('#module-form'), 'name').focus(); });
  bindDialogForm('module-form', async (event, form) => { const values = readForm(form); const name = String(values.name || '').trim(); if (!name) return; const submodules = String(values.submodules || '').split('\n').map((part) => part.trim()).filter(Boolean); await updateProject((p) => { p.modules ||= []; p.modules.push({ id: newId(), name, submodules }); }); closeDialog($('#module-dialog')); form.reset(); showNotice('Module added.'); });
  $('#submodule-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = field(event.currentTarget, 'name').value.trim(); if (!name || !pendingSubmoduleModuleId) return; await updateProject((p) => { const module = (p.modules || []).find((entry) => entry.id === pendingSubmoduleModuleId); if (module) { module.submodules ||= []; module.submodules.push(name); } }); pendingSubmoduleModuleId = null; closeDialog($('#submodule-dialog')); event.currentTarget.reset(); showNotice('Submodule added.'); });
  $('#add-link').addEventListener('click', () => { $('#link-form').reset(); openDialog('link-dialog'); field($('#link-form'), 'label').focus(); });
  bindDialogForm('link-form', async (event, form) => { const values = readForm(form); const label = String(values.label || '').trim(); const url = safeUrl(String(values.url || '').trim()); if (!label || !url) { field(form, 'url').setCustomValidity('Enter a valid http or https URL.'); field(form, 'url').reportValidity(); field(form, 'url').setCustomValidity(''); return; } await updateProject((p) => { p.links ||= []; p.links.push({ id: newId(), label, url }); }); closeDialog($('#link-dialog')); form.reset(); showNotice('IMP link added.'); });
  $('#add-milestone').addEventListener('click', () => { $('#milestone-form').reset(); openDialog('milestone-dialog'); field($('#milestone-form'), 'name').focus(); });
  bindDialogForm('milestone-form', async (event, form) => { const values = readForm(form); const name = String(values.name || '').trim(); const rawUrl = String(values.url || '').trim(); const url = rawUrl ? safeUrl(rawUrl) : ''; if (!name || (rawUrl && !url)) { if (rawUrl && !url) { field(form, 'url').setCustomValidity('Enter a valid http or https URL.'); field(form, 'url').reportValidity(); field(form, 'url').setCustomValidity(''); } return; } await updateProject((p) => { p.milestones ||= []; p.milestones.push({ id: newId(), name, date: values.date || '', url }); }); closeDialog($('#milestone-dialog')); form.reset(); showNotice('Milestone added.'); });
  $('#back-to-projects').addEventListener('click', async () => { activeProjectId = null; activeProjectCache = null; projectView.hidden = true; projectsView.hidden = false; history.replaceState(null, '', `${location.pathname}${location.search}`); await renderProjects(); });
  $('#grid-view').addEventListener('click', () => setView('grid')); $('#list-view').addEventListener('click', () => setView('list'));
  function setView(view) { projectList.classList.toggle('list-layout', view === 'list'); $('#grid-view').classList.toggle('is-active', view === 'grid'); $('#list-view').classList.toggle('is-active', view === 'list'); $('#grid-view').setAttribute('aria-pressed', String(view === 'grid')); $('#list-view').setAttribute('aria-pressed', String(view === 'list')); try { localStorage.setItem('project-layout', view); } catch { /* Optional preference */ } }
  $('#project-search').addEventListener('input', () => renderProjects().catch((error) => showNotice(error.message, true)));
  $('#status-filter').addEventListener('change', () => renderProjects().catch((error) => showNotice(error.message, true)));
  $('#delete-project').addEventListener('click', async () => {
    if (!activeProjectId || !confirm(`Delete “${activeProjectCache?.name || 'this project'}” and its tasks from this browser? This cannot be undone.`)) return;
    try {
      if (fallbackMode) { fallbackProjects = fallbackProjects.filter((project) => project.id !== activeProjectId); localStorage.setItem('project-hub-projects', JSON.stringify(fallbackProjects)); }
      else {
        const tasks = await getTasks(); const tx = db.transaction(['projects', 'tasks'], 'readwrite'); tx.objectStore('projects').delete(activeProjectId); tasks.forEach((task) => tx.objectStore('tasks').delete(task.id));
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      }
      activeProjectId = null; activeProjectCache = null; projectView.hidden = true; projectsView.hidden = false; history.replaceState(null, '', `${location.pathname}${location.search}`); await renderProjects(); showNotice('Project and tasks deleted.');
    } catch (error) { showNotice(`Could not delete project: ${error.message}`, true); }
  });
  $('#export-projects').addEventListener('click', async () => { try { const projects = await getProjects(); if (!fallbackMode) { for (const project of projects) project.tasks = await getTasks(project.id); } const blob = new Blob([JSON.stringify({ format: 'project-hub-backup', version: 2, exportedAt: new Date().toISOString(), projects }, null, 2)], { type: 'application/json' }); downloadBlob(blob, `project-hub-backup-${new Date().toISOString().slice(0,10)}.json`); showNotice('JSON backup exported.'); } catch (error) { showNotice(`Export failed: ${error.message}`, true); } });
  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  $('#export-csv').addEventListener('click', async () => { try { const projects = await getProjects(); const rows = [['Project','Owner','Status','Start date','End date','Task','Task owner','Task status','Task due date']]; for (const project of projects) { const tasks = await getTasks(project.id); if (tasks.length) tasks.forEach((task) => rows.push([project.name, project.owner, statusLabel(project.status), project.startDate, project.endDate, task.title, task.owner, statusLabel(task.status), task.dueDate])); else rows.push([project.name, project.owner, statusLabel(project.status), project.startDate, project.endDate, '', '', '', '']); } downloadBlob(new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'project-hub-projects.csv'); showNotice('CSV exported.'); } catch (error) { showNotice(`CSV export failed: ${error.message}`, true); } });
  function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('#import-projects').addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const parsed = JSON.parse(await file.text()); const items = Array.isArray(parsed) ? parsed : parsed.projects; if (!Array.isArray(items)) throw new Error('This file does not contain a project backup.'); for (const source of items) { if (!source || typeof source.name !== 'string' || !source.name.trim()) continue; const project = { ...source, id: newId(), name: source.name.trim(), team: Array.isArray(source.team) ? source.team : [], modules: Array.isArray(source.modules) ? source.modules : [], links: Array.isArray(source.links) ? source.links : [], milestones: Array.isArray(source.milestones) ? source.milestones : [], updatedAt: Date.now() }; const tasks = Array.isArray(source.tasks) ? source.tasks : []; project.tasks = tasks.map((task) => ({ ...task, id: newId(), projectId: project.id })); await saveProject(project); if (!fallbackMode) for (const task of project.tasks) await requestResult(txStore('tasks', 'readwrite').put(task)); } await renderProjects(); showNotice(`${items.length} project record(s) imported.`); } catch (error) { showNotice(`Import failed: ${error.message}`, true); } finally { event.target.value = ''; } });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.close))));
  window.addEventListener('hashchange', async () => { if (!db && !fallbackMode) return; if (location.hash.startsWith('#project-')) { const id = decodeURIComponent(location.hash.slice('#project-'.length)); await selectProject(id); } else if (projectView && !projectView.hidden) { activeProjectId = null; projectView.hidden = true; projectsView.hidden = false; await renderProjects(); } });
  async function initialize() {
    try { await openDatabase(); }
    catch (error) {
      console.warn('IndexedDB unavailable, trying localStorage fallback:', error);
      try { fallbackRead(); localStorage.setItem('project-hub-projects', JSON.stringify(fallbackProjects)); fallbackMode = true; showNotice('Using this browser’s local backup storage. Data remains on this device.'); }
      catch { showNotice(`Project Hub storage is unavailable: ${error.message}. Enable site storage and reload.`, true); $('#open-create-project').disabled = true; return; }
    }
    let view = 'grid'; try { view = localStorage.getItem('project-layout') === 'list' ? 'list' : 'grid'; } catch { /* Optional preference */ }
    setView(view); await renderProjects();
    if (location.hash.startsWith('#project-')) await selectProject(decodeURIComponent(location.hash.slice('#project-'.length)));
  }
  initialize().catch((error) => { console.error('Project Hub startup failed:', error); showNotice(`Project Hub could not start: ${error.message || 'reload the page and try again'}`, true); $('#open-create-project').disabled = true; });
})();
