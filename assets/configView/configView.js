// LLS OAI Configuration View Script
(function () {
	const vscode = acquireVsCodeApi();

	// State
	let providers = [];
	let editingProviderId = null;
	let editingModelProviderId = null;
	let editingModelIndex = -1;
	let editingModelData = null;
	let newlyAddedProviderId = null;
	const expandedProviders = new Set();

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
			} else if (target.classList.contains('add-model-btn')) {
				// Add new model to provider
				const providerId = target.dataset.providerId;
				if (providerId) addModelToProvider(providerId);
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
			
			// Check if it's a model selector toggle
			if (checkbox.classList.contains('model-selector-toggle')) {
				const modelId = checkbox.dataset.modelId;
				const providerId = checkbox.dataset.providerId;
				if (!modelId || !providerId) return;
				
				const provider = providers.find(p => p.id === providerId);
				if (!provider) return;
				
				const models = provider.models || provider.apiModels || [];
				const modelIndex = models.findIndex(m => m.modelId === modelId);
				if (modelIndex < 0) return;
				
				models[modelIndex].isUserSelectable = checkbox.checked;
				
				vscode.postMessage({
					command: 'updateProvider',
					data: {
						id: providerId,
						models: models,
					},
				});
				// Re-render to preserve expand state
				renderProviders();
				return;
			}
			
			const card = checkbox.closest('.provider-card');
			if (!card) return;
			const id = card.dataset.id;
			if (!id) return;
			vscode.postMessage({
				command: 'toggleProvider',
				data: { id, enabled: checkbox.checked },
			});
		});
	}

	// Handle messages from extension
	window.addEventListener('message', (event) => {
		const message = event.data;

		switch (message.command) {
			case 'providersLoaded':
				providers = message.data || [];
				// Expand newly added provider
				if (newlyAddedProviderId) {
					expandedProviders.add(newlyAddedProviderId);
					newlyAddedProviderId = null;
				}
				renderProviders();
				break;

			case 'providerAdded':
				if (!message.success) {
					alert(`Failed to add provider: ${message.error}`);
				} else if (message.data?.id) {
					// Store the newly added provider ID to expand after providersLoaded
					newlyAddedProviderId = message.data.id;
				}
				break;
		}
	});

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
								<span class="toggle-icon">${expandedProviders.has(provider.id) ? '▼' : '▶'}</span>
							</button>
						</h4>
						<div class="models-list" data-provider-id="${provider.id}" style="display: ${expandedProviders.has(provider.id) ? 'flex' : 'none'};">
							${(provider.models || provider.apiModels).map(m => `
								<div class="model-item" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}">
									<span class="model-item-name">${escapeHtml(m.displayName || m.modelId)}</span>
									<div class="model-item-actions">
										<label class="toggle model-toggle" title="Show in Chat Selector">
											<input type="checkbox" class="model-selector-toggle" data-model-id="${escapeHtml(m.modelId)}" data-provider-id="${provider.id}" ${m.isUserSelectable === true ? 'checked' : ''}>
											<span class="toggle-slider"></span>
										</label>
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
					<button class="primary-btn add-model-btn" data-provider-id="${provider.id}">+ Add Model</button>
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
		// Ensure models list remains expanded
		expandedProviders.add(id);
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

	// Add a new model to a provider
	function addModelToProvider(providerId) {
		const provider = providers.find(p => p.id === providerId);
		if (!provider) return;
		
		editingModelProviderId = providerId;
		editingModelIndex = -1; // -1 means new model
		editingModelData = {
			modelId: '',
			displayName: '',
			contextLength: 128000,
			maxTokens: 4096,
			vision: false,
			toolCalling: true,
			temperature: 0.7,
			topP: 1.0,
			samplingMode: 'both',
			isUserSelectable: false,
			transformThink: false,
		};
		
		const modelName = document.getElementById('editModelName');
		const modelDisplayName = document.getElementById('editModelDisplayName');
		const modelContextLength = document.getElementById('editModelContextLength');
		const modelMaxTokens = document.getElementById('editModelMaxTokens');
		const modelVision = document.getElementById('editModelVision');
		const modelToolCalling = document.getElementById('editModelToolCalling');
		const modelTemperature = document.getElementById('editModelTemperature');
		const modelTopP = document.getElementById('editModelTopP');
		const modelSamplingMode = document.getElementById('editModelSamplingMode');
		const modelUserSelectable = document.getElementById('editModelUserSelectable');
		const modelTransformThink = document.getElementById('editModelTransformThink');
		
		if (modelName) modelName.value = '';
		if (modelDisplayName) modelDisplayName.value = '';
		if (modelContextLength) modelContextLength.value = 128000;
		if (modelMaxTokens) modelMaxTokens.value = 4096;
		if (modelVision) modelVision.checked = false;
		if (modelToolCalling) modelToolCalling.checked = true;
		if (modelTemperature) modelTemperature.value = 0.7;
		if (modelTopP) modelTopP.value = 1.0;
		if (modelSamplingMode) modelSamplingMode.value = 'both';
		if (modelUserSelectable) modelUserSelectable.checked = false;
		if (modelTransformThink) modelTransformThink.checked = false;
		
		// Ensure models list remains expanded
		expandedProviders.add(providerId);
		
		const editModelModal = document.getElementById('editModelModal');
		if (editModelModal) {
			editModelModal.classList.add('active');
		}
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
		const modelSamplingMode = document.getElementById('editModelSamplingMode');
		const modelUserSelectable = document.getElementById('editModelUserSelectable');
		const modelTransformThink = document.getElementById('editModelTransformThink');
		
		if (modelName) modelName.value = editingModelData.modelId || '';
		if (modelDisplayName) modelDisplayName.value = editingModelData.displayName || '';
		if (modelContextLength) modelContextLength.value = editingModelData.contextLength || 128000;
		if (modelMaxTokens) modelMaxTokens.value = editingModelData.maxTokens || 4096;
		if (modelVision) modelVision.checked = editingModelData.vision || false;
		if (modelToolCalling) modelToolCalling.checked = editingModelData.toolCalling ?? true;
		if (modelTemperature) modelTemperature.value = editingModelData.temperature ?? 0.7;
		if (modelTopP) modelTopP.value = editingModelData.topP ?? 1.0;
		if (modelSamplingMode) modelSamplingMode.value = editingModelData.samplingMode ?? 'both';
		if (modelUserSelectable) modelUserSelectable.checked = editingModelData.isUserSelectable ?? false;
		if (modelTransformThink) modelTransformThink.checked = editingModelData.transformThink ?? false;
		
		// Ensure provider remains expanded when editing
		expandedProviders.add(providerId);
		
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
		const modelSamplingMode = document.getElementById('editModelSamplingMode');
		const modelUserSelectable = document.getElementById('editModelUserSelectable');
		const modelTransformThink = document.getElementById('editModelTransformThink');
		
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
		editingModelData.samplingMode = modelSamplingMode?.value || 'both';
		editingModelData.isUserSelectable = modelUserSelectable?.checked ?? true;
		editingModelData.transformThink = modelTransformThink?.checked ?? false;
		
		// Update the provider
		const provider = providers.find(p => p.id === editingModelProviderId);
		if (provider) {
			const models = provider.models || provider.apiModels || [];
			if (editingModelIndex >= 0) {
				// Edit existing model
				models[editingModelIndex] = editingModelData;
			} else {
				// Add new model
				models.push(editingModelData);
			}
			
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
		
		// Re-render to preserve expand state
		renderProviders();
	}

	// Toggle models list visibility
	function toggleModelsList(providerId) {
		const modelsList = document.querySelector(`.models-list[data-provider-id="${providerId}"]`);
		const toggleIcon = document.querySelector(`.models-toggle-btn[data-provider-id="${providerId}"] .toggle-icon`);
		
		if (modelsList && toggleIcon) {
			const isHidden = modelsList.style.display === 'none';
			modelsList.style.display = isHidden ? 'flex' : 'none';
			toggleIcon.textContent = isHidden ? '▼' : '▶';
			if (isHidden) {
				expandedProviders.add(providerId);
			} else {
				expandedProviders.delete(providerId);
			}
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
				},
			});
		} else {
			// Add new provider - backend will auto-fetch models
			vscode.postMessage({
				command: 'addProvider',
				data: providerData,
			});
		}

		closeProviderModal();
		// Re-render to preserve expand state
		renderProviders();
	};

	// Escape HTML to prevent XSS
	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}
})();
