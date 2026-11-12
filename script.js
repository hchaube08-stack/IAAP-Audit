const DB_NAME = 'project-hub-local';
const DB_VERSION = 2;
const projectList = document.getElementById('project-list');
const emptyProjectList = document.getElementById('empty-project-list');
const projectForm = document.getElementById('project-form');
const tasksPanel = document.getElementById('tasks-panel');
const taskForm = document.getElementById('task-form');
const taskList = document.getElementById('task-list');
const emptyTasks = document.getElementById('empty-tasks');
const filesPanel = document.getElementById('files-panel');
const fileList = document.getElementById('file-list');
const emptyFiles = document.getElementById('empty-files');
const filePicker = document.getElementById('file-picker');
const notice = document.getElementById('notice');
const saveProjectButton = document.getElementById('save-project');
const resetProjectButton = document.getElementById('reset-project');
const deleteProjectButton = document.getElementById('delete-project');
const detailsTitle = document.getElementById('details-title');
const filesTitle = document.getElementById('files-title');
const selectedTaskDescription = document.getElementById('selected-task-description');
let db;
let activeProjectId = null;
let activeTaskId = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
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
        if (!files.indexNames.contains('taskId')) files.createIndex('taskId', 'taskId', { unique: false });
      }
      if (!database.objectStoreNames.contains('tasks')) {
        const tasks = database.createObjectStore('tasks', { keyPath: 'id' });
        tasks.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function requestResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function store(name, mode = 'readonly') { return db.transaction(name, mode).objectStore(name); }
function getAllProjects() { return requestResult(store('projects').getAll()); }
function getProjectTasks(projectId) { return requestResult(store('tasks').index('projectId').getAll(projectId)); }
function getTaskFiles(taskId) { return requestResult(store('files').index('taskId').getAll(taskId)); }
function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(showNotice.timeout);
  showNotice.timeout = setTimeout(() => { notice.hidden = true; }, 5000);
}
function readableStatus(status) {
  return ({ planning: 'Planning', 'in-progress': 'In progress', 'on-hold': 'On hold', complete: 'Complete' })[status] || 'Planning';
}
async function renderProjects() {
  const projects = (await getAllProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
  projectList.replaceChildren();
  emptyProjectList.hidden = projects.length > 0;
  projects.forEach((project) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'project-choice';
    link.href = `#project-${encodeURIComponent(project.id)}`;
    link.setAttribute('aria-current', String(project.id === activeProjectId));
    const name = document.createElement('strong');
    name.textContent = project.name;
    const status = document.createElement('small');
    status.textContent = readableStatus(project.status);
    link.append(name, status);
    link.addEventListener('click', (event) => { event.preventDefault(); selectProject(project.id); });
    item.append(link);
    projectList.append(item);
  });
}
function clearProjectForm() {
  activeProjectId = null;
  activeTaskId = null;
  projectForm.reset();
  taskForm.reset();
  detailsTitle.textContent = 'New project';
  saveProjectButton.textContent = 'Create project';
  resetProjectButton.hidden = true;
  deleteProjectButton.hidden = true;
  tasksPanel.hidden = true;
  filesPanel.hidden = true;
  taskList.replaceChildren();
  fileList.replaceChildren();
}
async function selectProject(id) {
  const project = await requestResult(store('projects').get(id));
  if (!project) return;
  activeProjectId = id;
  activeTaskId = null;
  projectForm.elements.name.value = project.name;
  projectForm.elements.owner.value = project.owner || '';
  projectForm.elements.status.value = project.status || 'planning';
  projectForm.elements.description.value = project.description || '';
  detailsTitle.textContent = 'Update project';
  saveProjectButton.textContent = 'Save changes';
  resetProjectButton.hidden = false;
  deleteProjectButton.hidden = false;
  tasksPanel.hidden = false;
  filesPanel.hidden = true;
  await renderProjects();
  await renderTasks();
  location.hash = `project-${encodeURIComponent(id)}`;
}
projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(projectForm);
  const name = String(values.get('name') || '').trim();
  if (!name) return;
  const existing = activeProjectId ? await requestResult(store('projects').get(activeProjectId)) : null;
  const project = {
    id: activeProjectId || crypto.randomUUID(), name,
    owner: String(values.get('owner') || '').trim(),
    status: String(values.get('status') || 'planning'),
    description: String(values.get('description') || '').trim(),
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now()
  };
  await requestResult(store('projects', 'readwrite').put(project));
  await selectProject(project.id);
  showNotice(existing ? 'Project updated.' : 'Project created. Select its name in the list to return to its tasks.');
});
document.getElementById('new-project').addEventListener('click', () => {
  clearProjectForm();
  renderProjects();
  projectForm.elements.name.focus();
});
resetProjectButton.addEventListener('click', () => { if (activeProjectId) selectProject(activeProjectId); else clearProjectForm(); });

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeProjectId) return;
  const values = new FormData(taskForm);
  const title = String(values.get('title') || '').trim();
  if (!title) return;
  const task = {
    id: crypto.randomUUID(), projectId: activeProjectId, title,
    description: String(values.get('description') || '').trim(), createdAt: Date.now(), updatedAt: Date.now()
  };
  await requestResult(store('tasks', 'readwrite').put(task));
  taskForm.reset();
  await renderTasks();
  showNotice(`Task “${title}” created. Select it to manage its files.`);
});
async function renderTasks() {
  if (!activeProjectId) return;
  const tasks = (await getProjectTasks(activeProjectId)).sort((a, b) => b.updatedAt - a.updatedAt);
  taskList.replaceChildren();
  emptyTasks.hidden = tasks.length > 0;
  tasks.forEach((task) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'task-choice';
    link.href = `#task-${encodeURIComponent(task.id)}`;
    link.setAttribute('aria-current', String(task.id === activeTaskId));
    const title = document.createElement('strong');
    title.textContent = task.title;
    const description = document.createElement('small');
    description.textContent = task.description || 'Select to open task files';
    link.append(title, description);
    link.addEventListener('click', (event) => { event.preventDefault(); selectTask(task.id); });
    item.append(link);
    taskList.append(item);
  });
}
async function selectTask(id) {
  const task = await requestResult(store('tasks').get(id));
  if (!task || task.projectId !== activeProjectId) return;
  activeTaskId = id;
  filesTitle.textContent = `Files — ${task.title}`;
  selectedTaskDescription.textContent = task.description || `Upload or update files related to “${task.title}”.`;
  filesPanel.hidden = false;
  await renderTasks();
  await renderFiles();
  location.hash = `task-${encodeURIComponent(id)}`;
  filesPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  filePicker.focus();
}
deleteProjectButton.addEventListener('click', async () => {
  if (!activeProjectId || !confirm('Delete this project, its tasks, and all their files from this browser?')) return;
  const projectId = activeProjectId;
  const transaction = db.transaction(['projects', 'tasks', 'files'], 'readwrite');
  transaction.objectStore('projects').delete(projectId);
  const tasksStore = transaction.objectStore('tasks');
  const taskRequest = tasksStore.index('projectId').openCursor(IDBKeyRange.only(projectId));
  taskRequest.onsuccess = () => {
    const cursor = taskRequest.result;
    if (!cursor) return;
    const taskId = cursor.value.id;
    transaction.objectStore('files').index('taskId').openCursor(IDBKeyRange.only(taskId)).onsuccess = (event) => {
      let fileCursor = event.target.result;
      if (fileCursor) { fileCursor.delete(); fileCursor.continue(); }
    };
    cursor.delete(); cursor.continue();
  };
  transaction.oncomplete = async () => { clearProjectForm(); await renderProjects(); showNotice('Project and associated tasks/files deleted from this browser.'); };
  transaction.onerror = () => showNotice('Could not delete the project. Please try again.');
});
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
async function renderFiles() {
  if (!activeTaskId) return;
  const files = (await getTaskFiles(activeTaskId)).sort((a, b) => b.updatedAt - a.updatedAt);
  fileList.replaceChildren();
  emptyFiles.hidden = files.length > 0;
  files.forEach((file) => {
    const item = document.createElement('li');
    item.className = 'file-item';
    const info = document.createElement('div'); info.className = 'file-info';
    const name = document.createElement('strong'); name.textContent = file.name;
    const metadata = document.createElement('small'); metadata.textContent = `${formatBytes(file.size)} · Updated ${new Date(file.updatedAt).toLocaleString()}`;
    info.append(name, metadata);
    const actions = document.createElement('div'); actions.className = 'file-actions';
    const download = document.createElement('a');
    download.className = 'file-action'; download.textContent = 'Download';
    download.href = URL.createObjectURL(file.blob); download.download = file.name;
    download.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(download.href), 1000), { once: true });
    const replace = document.createElement('button'); replace.type = 'button'; replace.className = 'file-action'; replace.textContent = 'Replace';
    replace.addEventListener('click', () => chooseReplacement(file));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'file-action remove'; remove.textContent = 'Remove';
    remove.addEventListener('click', async () => { await requestResult(store('files', 'readwrite').delete(file.id)); await renderFiles(); showNotice(`${file.name} removed.`); });
    actions.append(download, replace, remove); item.append(info, actions); fileList.append(item);
  });
}
filePicker.addEventListener('change', async () => {
  if (!activeProjectId || !activeTaskId) return;
  const selectedFiles = Array.from(filePicker.files || []);
  try {
    for (const file of selectedFiles) {
      await requestResult(store('files', 'readwrite').put({ id: crypto.randomUUID(), projectId: activeProjectId, taskId: activeTaskId, name: file.name, type: file.type, size: file.size, blob: file, updatedAt: Date.now() }));
    }
    await renderFiles();
    if (selectedFiles.length) showNotice(`${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} added to this task.`);
  } catch (error) {
    console.error(error); showNotice('The files could not be saved. Your browser may be out of storage space.');
  } finally { filePicker.value = ''; }
});
function chooseReplacement(existingFile) {
  const picker = document.createElement('input'); picker.type = 'file';
  picker.addEventListener('change', async () => {
    const replacement = picker.files?.[0]; if (!replacement) return;
    try {
      await requestResult(store('files', 'readwrite').put({ ...existingFile, name: replacement.name, type: replacement.type, size: replacement.size, blob: replacement, updatedAt: Date.now() }));
      await renderFiles(); showNotice(`${replacement.name} replaced the previous file.`);
    } catch (error) { console.error(error); showNotice('The replacement file could not be saved.'); }
  });
  picker.click();
}
(async function initialize() {
  if (!('indexedDB' in window) || !crypto?.randomUUID) { showNotice('This browser does not support the storage features this app needs. Please use a current browser.'); return; }
  try {
    db = await openDatabase();
    await renderProjects();
    if (location.hash.startsWith('#project-')) {
      const projectId = decodeURIComponent(location.hash.slice('#project-'.length));
      await selectProject(projectId);
    }
  } catch (error) { console.error(error); showNotice('Could not open local project storage. Check browser privacy settings and try again.'); }
})();
