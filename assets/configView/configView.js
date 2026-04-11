// LLS OAI Configuration View Script
(function () {
	const vscode = acquireVsCodeApi();

	// State
	let providers = [];
	let editingProviderId = null;
	let editingModels = [];
	let editingModelProviderId = null;
	let editingModelIndex = -1;
	let editingModelData = null;

	// DOM Elements
	const providersList = document.getElementById('providersList');
	const providerModal = document.getElementById('providerModal');
	const modalTitle = document.getElementById('modalTitle');
	const providerForm = document.getElementById('providerForm');
	const providerId = document.getElementById('providerId');
	const providerName = document.getElementById('providerName');
	const providerBaseUrl = document.getElementById('providerBaseUrl');
	const providerApiKey = document.getElementById('providerApiKey');
	const addProviderBtn = document.getElementById('addProviderBtn');
	const closeModal = document.getElementById('closeModal');
	const cancelBtn = document.getElementById('cancelBtn');
	const importBtn = document.getElementById('importBtn');
	const exportBtn = document.getElementById('exportBtn');
	const fetchModelsBtn = document.getElementById('fetchModelsBtn');
	const addModelBtn = document.getElementById('addModelBtn');
	const modelsListEditor = document.getElementById('modelsListEditor');
	const editModelModal = document.getElementById('editModelModal');
	const closeEditModelBtn = document.getElementById('closeEditModelBtn');
	const cancelEditModelBtn = document.getElementById('cancelEditModelBtn');
	const saveEditModelBtn = document.getElementById('saveEditModelBtn');

	// Initialize
	vscode.postMessage({ command: 'getProviders' });
	setupEventListeners();

	function setupEventListeners() {
		addProviderBtn.addEventListener('click', () => openAddProviderModal());
		closeModal.addEventListener('click', () => closeProviderModal());
		cancelBtn.addEventListener('click', () => closeProviderModal());
		closeEditModelBtn?.addEventListener('click', () => {
			editModelModal?.classList.remove('active');
		});
		cancelEditModelBtn?.addEventListener('click', () => {
			editModelModal?.classList.remove('active');
		});
		saveEditModelBtn?.addEventListener('click', () => {
			saveEditedModel();
		});
		importBtn.addEventListener('click', () => vscode.postMessage({ command: 'importConfig' }));
		exportBtn.addEventListener('click', () => vscode.postMessage({ command: 'exportConfig' }));
		fetchModelsBtn?.addEventListener('click', () => fetchModelsFromAPI());
		addModelBtn?.addEventListener('click', () => addModelToEditor());
		providerForm.addEventListener('submit', (e) => {
			e.preventDefault();
			saveProvider();
		});
		
		// Event delegation for dynamically created buttons
		providersList.addEventListener('click', (e) => {
			const target = e.target.closest('button');
			if (!target) {
				// Check for models toggle button (might be clicking the icon span)
				const toggleIcon = e.target.closest('.toggle-icon');
				if (toggleIcon) {
					const toggleBtn = toggleIcon.closest('.models-toggle-btn');
					if (toggleBtn) {
						toggleModelsList(toggleBtn.dataset.providerId);
					}
				}
				return;
			}
			
			console.log('[configView] Button clicked:', target.className, 'data-id:', target.dataset.id);
			
			if (target.classList.contains('models-toggle-btn')) {
				toggleModelsList(target.dataset.providerId);
			} else if (target.classList.contains('edit-btn')) {
				const id = target.dataset.id;
				if (id) editProvider(id);
			} else if (target.classList.contains('delete-btn')) {
				const id = target.dataset.id;
				if (id) deleteProvider(id);
			} else if (target.classList.contains('edit-model-btn')) {
				// Edit model in provider list
				const modelId = target.dataset.modelId;
				const providerId = target.dataset.providerId;
				if (modelId && providerId) editModelInProvider(providerId, modelId);
			} else if (target.classList.contains('delete-model-btn')) {
				// Delete model from provider list
				const modelId = target.dataset.modelId;
				const providerId = target.dataset.providerId;
				if (modelId && providerId) deleteModelFromProvider(providerId, modelId);
			} else if (target.closest('.toggle')) {
				const checkbox = target.closest('.toggle').querySelector('input[type="checkbox"]');
				if (checkbox) {
					const id = checkbox.closest('.provider-card')?.dataset.id;
					if (id) {
						vscode.postMessage({
							command: 'toggleProvider',
							data: { id, enabled: checkbox.checked },
						});
					}
				}
			}
		});
		
		// Handle checkbox toggle
		providersList.addEventListener('change', (e) => {
			const checkbox = e.target.closest('input[type="checkbox"]');
			if (!checkbox) return;
			const card = checkbox.closest('.provider-card');
			if (!card) return;
			const id = card.dataset.id;
			if (!id) return;
			vscode.postMessage({
				command: 'toggleProvider',
				data: { id, enabled: checkbox.checked },
			});
		});
		
		// Event delegation for models editor
		modelsListEditor?.addEventListener('click', (e) => {
			const target = e.target.closest('button');
			if (!target) return;
			
			if (target.classList.contains('delete-model-btn')) {
				const index = parseInt(target.dataset.index, 10);
				editingModels.splice(index, 1);
				renderModelsEditor();
			}
		});
		
		modelsListEditor?.addEventListener('input', (e) => {
			const target = e.target;
			if (target.classList.contains('model-input')) {
				const index = parseInt(target.dataset.index, 10);
				const field = target.dataset.field;
				if (editingModels[index]) {
					editingModels[index][field] = target.value;
				}
			}
		});
	}

	// Handle messages from extension
	window.addEventListener('message', (event) => {
		const message = event.data;

		switch (message.command) {
			case 'providersLoaded':
				providers = message.data || [];
				renderProviders();
				break;

			case 'providerAdded':
				if (!message.success) {
					alert(`Failed to add provider: ${message.error}`);
				}
				break;
				
			case 'modelsFetched':
				if (message.success) {
					editingModels = message.models || [];
					renderModelsEditor();
				} else {
					alert(`Failed to fetch models: ${message.error}`);
				}
				break;
		}
	});
	
	// Fetch models from API
	function fetchModelsFromAPI() {
		const baseUrl = providerBaseUrl?.value?.trim();
		const apiKey = providerApiKey?.value?.trim();
		
		if (!baseUrl || !apiKey) {
			alert('Please enter both Base URL and API Key first');
			return;
		}
		
		fetchModelsBtn.textContent = 'Fetching...';
		fetchModelsBtn.disabled = true;
		
		// Send existing models to merge with API models
		vscode.postMessage({
			command: 'fetchModels',
			data: { baseUrl, apiKey, existingModels: editingModels }
		});
		
		setTimeout(() => {
			if (fetchModelsBtn) {
				fetchModelsBtn.textContent = 'Fetch from API';
				fetchModelsBtn.disabled = false;
			}
		}, 5000);
	}
	
	// Add a new model to editor
	function addModelToEditor() {
		editingModels.push({
			modelId: '',
			displayName: '',
			contextLength: 128000,
			maxTokens: 4096,
			vision: false,
			toolCalling: true,
			temperature: 0.7,
			topP: 1.0
		});
		renderModelsEditor();
	}
	
	// Render models in the editor
	function renderModelsEditor() {
		if (!modelsListEditor) return;
		
		if (editingModels.length === 0) {
			modelsListEditor.innerHTML = '<div class="models-empty">No models added</div>';
			return;
		}
		
		modelsListEditor.innerHTML = editingModels.map((model, index) => `
			<div class="model-editor-item">
				<input type="text" class="model-input model-id-input" data-index="${index}" data-field="modelId" value="${escapeHtml(model.modelId)}" placeholder="Model ID" />
				<input type="text" class="model-input model-name-input" data-index="${index}" data-field="displayName" value="${escapeHtml(model.displayName)}" placeholder="Display Name" />
				<input type="number" class="model-input model-num-input" data-index="${index}" data-field="contextLength" value="${model.contextLength}" placeholder="Context" title="Context Length" />
				<input type="number" class="model-input model-num-input" data-index="${index}" data-field="maxTokens" value="${model.maxTokens}" placeholder="Max" title="Max Tokens" />
				<label class="model-vision-label">
					<input type="checkbox" class="model-input" data-index="${index}" data-field="vision" ${model.vision ? 'checked' : ''} />
					Vision
				</label>
				<label class="model-vision-label">
					<input type="checkbox" class="model-input" data-index="${index}" data-field="toolCalling" ${model.toolCalling !== false ? 'checked' : ''} />
					Tools
				</label>
				<button type="button" class="delete-model-btn secondary-btn" data-index="${index}">×</button>
			</div>
		`).join('');
		
		// Re-attach event listeners for vision checkboxes
		modelsListEditor.querySelectorAll('input[data-field="vision"]').forEach(cb => {
			cb.addEventListener('change', (e) => {
				const index = parseInt(e.target.dataset.index, 10);
				editingModels[index].vision = e.target.checked;
			});
		});
		
		// Re-attach event listeners for toolCalling checkboxes
		modelsListEditor.querySelectorAll('input[data-field="toolCalling"]').forEach(cb => {
			cb.addEventListener('change', (e) => {
				const index = parseInt(e.target.dataset.index, 10);
				editingModels[index].toolCalling = e.target.checked;
			});
		});
	}

	// Render providers list
	function renderProviders() {
		if (providers.length === 0) {
			providersList.innerHTML = `
				<div class="empty-state">
					<p>No providers configured yet</p>
					<button class="primary-btn" onclick="document.getElementById('addProviderBtn').click()">Add Your First Provider</button>
				</div>
			`;
			return;
		}

		providersList.innerHTML = providers.map(provider => `
			<div class="provider-card" data-id="${provider.id}">
				<div class="provider-header">
					<span class="provider-name">${escapeHtml(provider.name)}</span>
					<div class="provider-status">
						<span class="status-badge ${provider.enabled ? 'enabled' : 'disabled'}">
							${provider.enabled ? 'Enabled' : 'Disabled'}
						</span>
						<label class="toggle">
							<input type="checkbox" ${provider.enabled ? 'checked' : ''} data-id="${provider.id}">
							<span class="toggle-slider"></span>
						</label>
					</div>
				</div>
				<div class="provider-details">
					<div class="provider-detail-item">
						<span class="provider-detail-label">Base URL</span>
						<span>${escapeHtml(provider.baseUrl)}</span>
					</div>
					<div class="provider-detail-item">
						<span class="provider-detail-label">API Key</span>
						<span>${provider.hasApiKey ? '**** Configured' : '⚠️ Not Set'}</span>
					</div>
				</div>
				${(provider.models || provider.apiModels) && (provider.models || provider.apiModels).length > 0 ? `
					<div class="provider-models">
						<h4 class="models-header">
							<span>Models (${(provider.models || provider.apiModels).length})</span>
							<button class="models-toggle-btn" data-provider-id="${provider.id}">
								<span class="toggle-icon">▶</span>
							</button>
						</h4>
						<div class="models-list" data-provider-id="${provider.id}" style="display: none;">
							${(provider.models || provider.apiModels).map(m => `
								<div class="model-item" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}">
									<span class="model-item-name">${escapeHtml(m.displayName || m.modelId)}</span>
									<div class="model-item-actions">
										<button class="model-item-btn edit-model-btn" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}">Edit</button>
										<button class="model-item-btn delete delete-model-btn" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}">Delete</button>
									</div>
								</div>
							`).join('')}
						</div>
					</div>
				` : '<div class="provider-detail-item"><span class="provider-detail-label">Models</span><span>⚠️ No models (check API Key)</span></div>'}
				<div class="provider-actions">
					<button class="secondary-btn edit-btn" data-id="${provider.id}">Edit</button>
					<button class="secondary-btn delete-btn" data-id="${provider.id}">Delete</button>
				</div>
			</div>
		`).join('');
	}

	// Open modal for adding a new provider
	function openAddProviderModal() {
		editingProviderId = null;
		modalTitle.textContent = 'Add Provider';
		providerId.value = '';
		providerName.value = '';
		providerBaseUrl.value = '';
		providerApiKey.value = '';
		editingModels = [];
		renderModelsEditor();
		providerModal.classList.add('active');
	}

	// Open modal for editing a provider
	function editProvider(id) {
		const provider = providers.find(p => p.id === id);
		if (!provider) return;

		editingProviderId = id;
		modalTitle.textContent = 'Edit Provider';
		providerId.value = provider.id;
		providerName.value = provider.name;
		providerBaseUrl.value = provider.baseUrl;
		providerApiKey.value = ''; // Don't show existing key
		editingModels = (provider.models || provider.apiModels) ? [...(provider.models || provider.apiModels)] : [];
		renderModelsEditor();
		providerModal.classList.add('active');
	};

	// Close the modal
	function closeProviderModal() {
		providerModal.classList.remove('active');
		providerForm.reset();
		editingProviderId = null;
	}

	// Delete provider - confirmation handled by backend
	function deleteProvider(id) {
		if (!id) {
			console.error('[configView] deleteProvider: no id provided');
			return;
		}
		
		console.log('[configView] deleteProvider: sending delete request for id:', id);
		
		vscode.postMessage({
			command: 'deleteProvider',
			data: id
		});
	}

	// Edit a model directly from the provider list
	function editModelInProvider(providerId, modelId) {
		const provider = providers.find(p => p.id === providerId);
		if (!provider) return;
		
		const models = provider.models || provider.apiModels || [];
		const modelIndex = models.findIndex(m => m.modelId === modelId);
		if (modelIndex < 0) return;
		
		editingModelProviderId = providerId;
		editingModelIndex = modelIndex;
		editingModelData = JSON.parse(JSON.stringify(models[modelIndex]));
		
		const modelName = document.getElementById('editModelName');
		const modelDisplayName = document.getElementById('editModelDisplayName');
		const modelContextLength = document.getElementById('editModelContextLength');
		const modelMaxTokens = document.getElementById('editModelMaxTokens');
		const modelVision = document.getElementById('editModelVision');
		const modelToolCalling = document.getElementById('editModelToolCalling');
		const modelTemperature = document.getElementById('editModelTemperature');
		const modelTopP = document.getElementById('editModelTopP');
		
		if (modelName) modelName.value = editingModelData.modelId || '';
		if (modelDisplayName) modelDisplayName.value = editingModelData.displayName || '';
		if (modelContextLength) modelContextLength.value = editingModelData.contextLength || 128000;
		if (modelMaxTokens) modelMaxTokens.value = editingModelData.maxTokens || 4096;
		if (modelVision) modelVision.checked = editingModelData.vision || false;
		if (modelToolCalling) modelToolCalling.checked = editingModelData.toolCalling ?? true;
		if (modelTemperature) modelTemperature.value = editingModelData.temperature ?? 0.7;
		if (modelTopP) modelTopP.value = editingModelData.topP ?? 1.0;
		
		const editModelModal = document.getElementById('editModelModal');
		if (editModelModal) {
			editModelModal.classList.add('active');
		}
	}
	
	// Save edited model
	function saveEditedModel() {
		const modelName = document.getElementById('editModelName');
		const modelDisplayName = document.getElementById('editModelDisplayName');
		const modelContextLength = document.getElementById('editModelContextLength');
		const modelMaxTokens = document.getElementById('editModelMaxTokens');
		const modelVision = document.getElementById('editModelVision');
		const modelToolCalling = document.getElementById('editModelToolCalling');
		const modelTemperature = document.getElementById('editModelTemperature');
		const modelTopP = document.getElementById('editModelTopP');
		
		if (!modelName || !modelName.value.trim()) {
			alert('Model ID is required');
			return;
		}
		
		editingModelData.modelId = modelName.value.trim();
		editingModelData.displayName = modelDisplayName?.value.trim() || '';
		editingModelData.contextLength = parseInt(modelContextLength?.value, 10) || 128000;
		editingModelData.maxTokens = parseInt(modelMaxTokens?.value, 10) || 4096;
		editingModelData.vision = modelVision?.checked || false;
		editingModelData.toolCalling = modelToolCalling?.checked ?? true;
		editingModelData.temperature = parseFloat(modelTemperature?.value) ?? 0.7;
		editingModelData.topP = parseFloat(modelTopP?.value) ?? 1.0;
		
		// Update the provider
		const provider = providers.find(p => p.id === editingModelProviderId);
		if (provider) {
			const models = provider.models || provider.apiModels || [];
			models[editingModelIndex] = editingModelData;
			
			vscode.postMessage({
				command: 'updateProvider',
				data: {
					id: editingModelProviderId,
					models: models,
				},
			});
		}
		
		// Close modal
		const editModelModal = document.getElementById('editModelModal');
		if (editModelModal) {
			editModelModal.classList.remove('active');
		}
	}

	// Toggle models list visibility
	function toggleModelsList(providerId) {
		const modelsList = document.querySelector(`.models-list[data-provider-id="${providerId}"]`);
		const toggleIcon = document.querySelector(`.models-toggle-btn[data-provider-id="${providerId}"] .toggle-icon`);
		
		if (modelsList && toggleIcon) {
			const isHidden = modelsList.style.display === 'none';
			modelsList.style.display = isHidden ? 'flex' : 'none';
			toggleIcon.textContent = isHidden ? '▼' : '▶';
		}
	}

	// Delete a model directly from the provider list
	function deleteModelFromProvider(providerId, modelId) {
		const provider = providers.find(p => p.id === providerId);
		if (!provider) return;
		
		const models = provider.models || provider.apiModels || [];
		const modelIndex = models.findIndex(m => m.modelId === modelId);
		if (modelIndex < 0) return;
		
		// Remove the model and send update
		const updatedModels = models.filter((_, i) => i !== modelIndex);
		
		vscode.postMessage({
			command: 'updateProvider',
			data: {
				id: providerId,
				models: updatedModels,
			},
		});
	}

	// Save provider - models will be auto-fetched by the backend
	function saveProvider() {
		const name = providerName.value.trim();
		const baseUrl = providerBaseUrl.value.trim();
		const apiKey = providerApiKey.value.trim();

		if (!name) {
			alert('Please enter a provider name');
			return;
		}

		if (!baseUrl) {
			alert('Please enter a base URL');
			return;
		}

		if (!editingProviderId && !apiKey) {
			alert('Please enter an API key for new providers');
			return;
		}

		const providerData = { name, baseUrl, apiKey, enabled: true };

		if (editingProviderId) {
			// Update existing provider
			vscode.postMessage({
				command: 'updateProvider',
				data: {
					id: editingProviderId,
					...providerData,
					hasApiKey: !!apiKey || true,
					models: editingModels.filter(m => m.modelId.trim()),
				},
			});
		} else {
			// Add new provider - backend will auto-fetch models
			vscode.postMessage({
				command: 'addProvider',
				data: {
					...providerData,
					models: editingModels.filter(m => m.modelId.trim()),
				},
			});
		}

		closeProviderModal();
	}

	// Toggle provider enabled/disabled
	function toggleProvider(id, enabled) {
		vscode.postMessage({
			command: 'toggleProvider',
			data: { id, enabled },
		});
	};

	// Escape HTML to prevent XSS
	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}
})();
