/**
 * Template-related API routes for note templates
 * Provides CRUD operations and template-based note creation
 */

export const registerTemplateRoutes = (
  app,
  supabase,
  {
    authMiddleware,
    rateLimit,
    resolveWorkspaceIdForRequest,
    normalizeNullableText,
    htmlToPlainText,
    normalizeNoteHtml,
    plainTextToParagraphHtml,
  }
) => {
  // GET /api/templates - List all templates in workspace
  app.get('/api/templates', authMiddleware, rateLimit('read'), async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const category = req.query?.category ? String(req.query.category).trim() : null;

      let query = supabase
        .from('note_templates')
        .select(
          'id, name, description, category, is_default, is_system, usage_count, created_at, created_by'
        )
        .eq('workspace_id', workspaceId);

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query
        .order('usage_count', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json(data ?? []);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/templates/:id - Get single template
  app.get('/api/templates/:id', authMiddleware, rateLimit('read'), async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const { data, error } = await supabase
        .from('note_templates')
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .eq('id', String(req.params.id))
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Template not found' });

      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/templates - Create new template
  app.post('/api/templates', authMiddleware, rateLimit('write'), async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const name = String(req.body?.name ?? '').trim();
      const description = normalizeNullableText(req.body?.description);
      const category = String(req.body?.category ?? 'personal')
        .trim()
        .toLowerCase();
      const rawContentHtml =
        req.body?.content_html !== undefined ? String(req.body.content_html).trim() : null;
      const incomingContent =
        req.body?.content !== undefined ? String(req.body.content).trim() : null;
      const isDefault = Boolean(req.body?.is_default ?? false);

      if (!name) {
        return res.status(400).json({ error: 'Template name is required' });
      }

      const content_html = normalizeNoteHtml(
        rawContentHtml ?? plainTextToParagraphHtml(incomingContent ?? '')
      );

      const { data, error } = await supabase
        .from('note_templates')
        .insert({
          workspace_id: workspaceId,
          name,
          description,
          content_html,
          category,
          is_default: isDefault,
          is_system: false,
          usage_count: 0,
          created_by: req.authUser.id,
        })
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/templates/:id - Update template
  app.patch('/api/templates/:id', authMiddleware, rateLimit('write'), async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);

      // Check ownership (non-system templates only)
      const { data: existing, error: checkError } = await supabase
        .from('note_templates')
        .select('id, created_by, is_system')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (checkError) throw checkError;
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.is_system && existing.created_by !== req.authUser.id) {
        return res.status(403).json({ error: 'Cannot edit system templates' });
      }
      if (existing.created_by !== req.authUser.id) {
        return res.status(403).json({ error: 'Can only edit your own templates' });
      }

      const update = {};
      if (req.body?.name !== undefined) {
        const nextName = String(req.body.name).trim();
        if (!nextName) return res.status(400).json({ error: 'Template name is required' });
        update.name = nextName;
      }
      if (req.body?.description !== undefined)
        update.description = normalizeNullableText(req.body.description);
      if (req.body?.category !== undefined)
        update.category = String(req.body.category).trim().toLowerCase();
      if (req.body?.content_html !== undefined) {
        const html = normalizeNoteHtml(req.body.content_html);
        update.content_html = html;
      }
      if (req.body?.is_default !== undefined) update.is_default = Boolean(req.body.is_default);

      update.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('note_templates')
        .update(update)
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/templates/:id - Delete template
  app.delete('/api/templates/:id', authMiddleware, rateLimit('write'), async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);

      const { data: existing, error: checkError } = await supabase
        .from('note_templates')
        .select('created_by, is_system')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (checkError) throw checkError;
      if (!existing) return res.status(404).json({ error: 'Template not found' });
      if (existing.is_system)
        return res.status(403).json({ error: 'Cannot delete system templates' });
      if (existing.created_by !== req.authUser.id) {
        return res.status(403).json({ error: 'Can only delete your own templates' });
      }

      const { error } = await supabase
        .from('note_templates')
        .delete()
        .eq('id', templateId)
        .eq('workspace_id', workspaceId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/templates/:id/duplicate - Duplicate template
  app.post('/api/templates/:id/duplicate', authMiddleware, rateLimit('write'), async (req, res) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(req);
      const templateId = String(req.params.id);

      const { data: original, error: fetchError } = await supabase
        .from('note_templates')
        .select('name, description, content_html, category')
        .eq('id', templateId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!original) return res.status(404).json({ error: 'Template not found' });

      const duplicatedName = `${original.name} (Copy)`;

      const { data, error } = await supabase
        .from('note_templates')
        .insert({
          workspace_id: workspaceId,
          name: duplicatedName,
          description: original.description,
          content_html: original.content_html,
          category: original.category,
          is_default: false,
          is_system: false,
          usage_count: 0,
          created_by: req.authUser.id,
        })
        .select(
          'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
        )
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/notes/from-template/:templateId - Create note from template
  app.post(
    '/api/notes/from-template/:templateId',
    authMiddleware,
    rateLimit('write'),
    async (req, res) => {
      try {
        const workspaceId = await resolveWorkspaceIdForRequest(req);
        const templateId = String(req.params.templateId);

        const { data: template, error: templateError } = await supabase
          .from('note_templates')
          .select('id, name, content_html')
          .eq('id', templateId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (templateError) throw templateError;
        if (!template) return res.status(404).json({ error: 'Template not found' });

        // Increment template usage count
        await supabase
          .from('note_templates')
          .update({ usage_count: supabase.rpc('increment', { x: 1 }) })
          .eq('id', templateId)
          .catch(() => {}); // Silent fail on usage count increment

        // Create note from template
        const content_html = template.content_html;
        const content_plain = htmlToPlainText(content_html);
        const date = new Date().toISOString().slice(0, 10);

        const { data: note, error: noteError } = await supabase
          .from('notes')
          .insert({
            workspace_id: workspaceId,
            user_id: req.authUser.id,
            title: template.name,
            content: content_plain,
            content_html,
            date,
            source: 'template',
            template_id: templateId,
          })
          .select(
            'id, title, content, content_html, date, mood, source, mode, mind_map_structure, parent_id, sort_order, depth, created_at, updated_at'
          )
          .single();

        if (noteError) throw noteError;

        res.status(201).json({
          id: note.id,
          title: note.title,
          content: note.content || content_plain,
          content_html: note.content_html || content_html,
          date: note.date,
          source: note.source,
          template_id: templateId,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  // POST /api/templates/from-note/:noteId - Save note as template
  app.post(
    '/api/templates/from-note/:noteId',
    authMiddleware,
    rateLimit('write'),
    async (req, res) => {
      try {
        const workspaceId = await resolveWorkspaceIdForRequest(req);
        const noteId = String(req.params.noteId);

        const { data: note, error: noteError } = await supabase
          .from('notes')
          .select('id, title, content, content_html')
          .eq('id', noteId)
          .eq('workspace_id', workspaceId)
          .eq('user_id', req.authUser.id)
          .maybeSingle();

        if (noteError) throw noteError;
        if (!note) return res.status(404).json({ error: 'Note not found' });

        const templateName = String(req.body?.name ?? note.title).trim() || 'Untitled Template';
        const templateDescription = normalizeNullableText(req.body?.description);
        const templateCategory = String(req.body?.category ?? 'personal')
          .trim()
          .toLowerCase();
        const isDefault = Boolean(req.body?.is_default ?? false);

        const { data: template, error } = await supabase
          .from('note_templates')
          .insert({
            workspace_id: workspaceId,
            name: templateName,
            description: templateDescription,
            content_html: note.content_html || plainTextToParagraphHtml(note.content || ''),
            category: templateCategory,
            is_default: isDefault,
            is_system: false,
            usage_count: 0,
            created_by: req.authUser.id,
          })
          .select(
            'id, name, description, content_html, category, is_default, is_system, usage_count, created_at, updated_at, created_by'
          )
          .single();

        if (error) throw error;
        res.status(201).json({
          success: true,
          template,
          message: 'Note saved as template successfully',
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  // PATCH /api/templates/:id/set-default - Toggle is_default flag
  app.patch(
    '/api/templates/:id/set-default',
    authMiddleware,
    rateLimit('write'),
    async (req, res) => {
      try {
        const workspaceId = await resolveWorkspaceIdForRequest(req);
        const templateId = String(req.params.id);
        const isDefault = Boolean(req.body?.is_default);

        const { data: existing, error: checkError } = await supabase
          .from('note_templates')
          .select('created_by')
          .eq('id', templateId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (checkError) throw checkError;
        if (!existing) return res.status(404).json({ error: 'Template not found' });
        if (existing.created_by !== req.authUser.id) {
          return res.status(403).json({ error: 'Can only modify your own templates' });
        }

        const { data, error } = await supabase
          .from('note_templates')
          .update({ is_default: isDefault, updated_at: new Date().toISOString() })
          .eq('id', templateId)
          .eq('workspace_id', workspaceId)
          .select('id, is_default')
          .single();

        if (error) throw error;
        res.json(data);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }
  );
};
