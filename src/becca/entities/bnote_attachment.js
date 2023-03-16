"use strict";

const protectedSessionService = require('../../services/protected_session');
const utils = require('../../services/utils');
const sql = require('../../services/sql');
const dateUtils = require('../../services/date_utils');
const becca = require('../becca');
const entityChangesService = require('../../services/entity_changes');
const AbstractBeccaEntity = require("./abstract_becca_entity");

/**
 * NoteAttachment represent data related/attached to the note. Conceptually similar to attributes, but intended for
 * larger amounts of data and generally not accessible to the user.
 *
 * @extends AbstractBeccaEntity
 */
class BNoteAttachment extends AbstractBeccaEntity {
    static get entityName() { return "note_attachments"; }
    static get primaryKeyName() { return "noteAttachmentId"; }
    static get hashedProperties() { return ["noteAttachmentId", "parentId", "role", "mime", "title", "utcDateModified"]; }

    constructor(row) {
        super();

        if (!row.parentId?.trim()) {
            throw new Error("'noteId' must be given to initialize a NoteAttachment entity");
        } else if (!row.role?.trim()) {
            throw new Error("'role' must be given to initialize a NoteAttachment entity");
        } else if (!row.mime?.trim()) {
            throw new Error("'mime' must be given to initialize a NoteAttachment entity");
        } else if (!row.title?.trim()) {
            throw new Error("'title' must be given to initialize a NoteAttachment entity");
        }

        /** @type {string} needs to be set at the initialization time since it's used in the .setContent() */
        this.noteAttachmentId = row.noteAttachmentId || `${this.noteId}_${this.name}`; // FIXME
        /** @type {string} either noteId or noteRevisionId to which this attachment belongs */
        this.parentId = row.parentId;
        /** @type {string} */
        this.role = row.role;
        /** @type {string} */
        this.mime = row.mime;
        /** @type {string} */
        this.title = row.title;
        /** @type {boolean} */
        this.isProtected = !!row.isProtected;
        /** @type {string} */
        this.utcDateModified = row.utcDateModified;
    }

    getNote() {
        return becca.notes[this.parentId];
    }

    /** @returns {boolean} true if the note has string content (not binary) */
    isStringNote() {
        return utils.isStringNote(this.type, this.mime);
    }

    /** @returns {*} */
    getContent(silentNotFoundError = false) {
        const res = sql.getRow(`SELECT content FROM note_attachment_contents WHERE noteAttachmentId = ?`, [this.noteAttachmentId]);

        if (!res) {
            if (silentNotFoundError) {
                return undefined;
            }
            else {
                throw new Error(`Cannot find note attachment content for noteAttachmentId=${this.noteAttachmentId}`);
            }
        }

        let content = res.content;

        if (this.isProtected) {
            if (protectedSessionService.isProtectedSessionAvailable()) {
                content = protectedSessionService.decrypt(content);
            }
            else {
                content = "";
            }
        }

        if (this.isStringNote()) {
            return content === null
                ? ""
                : content.toString("UTF-8");
        }
        else {
            return content;
        }
    }

    setContent(content) {
        sql.transactional(() => {
            this.save(); // also explicitly save note_attachment to update contentCheckSum

            const pojo = {
                noteAttachmentId: this.noteAttachmentId,
                content: content,
                utcDateModified: dateUtils.utcNowDateTime()
            };

            if (this.isProtected) {
                if (protectedSessionService.isProtectedSessionAvailable()) {
                    pojo.content = protectedSessionService.encrypt(pojo.content);
                } else {
                    throw new Error(`Cannot update content of noteAttachmentId=${this.noteAttachmentId} since we're out of protected session.`);
                }
            }

            sql.upsert("note_attachment_contents", "noteAttachmentId", pojo);

            entityChangesService.addEntityChange({
                entityName: 'note_attachment_contents',
                entityId: this.noteAttachmentId,
                hash: this.contentCheckSum, // FIXME
                isErased: false,
                utcDateChanged: pojo.utcDateModified,
                isSynced: true
            });
        });
    }

    calculateCheckSum(content) {
        return utils.hash(`${this.noteAttachmentId}|${content.toString()}`);
    }

    beforeSaving() {
        if (!this.name.match(/^[a-z0-9]+$/i)) {
            throw new Error(`Name must be alphanumerical, "${this.name}" given.`);
        }

        this.noteAttachmentId = `${this.noteId}_${this.name}`; // FIXME

        super.beforeSaving();

        this.utcDateModified = dateUtils.utcNowDateTime();
    }

    getPojo() {
        return {
            noteAttachmentId: this.noteAttachmentId,
            parentId: this.parentId,
            name: this.name,
            mime: this.mime,
            isProtected: !!this.isProtected,
            contentCheckSum: this.contentCheckSum, // FIXME
            isDeleted: false,
            utcDateModified: this.utcDateModified
        };
    }

    getPojoToSave() {
        const pojo = this.getPojo();
        delete pojo.content; // not getting persisted

        return pojo;
    }
}

module.exports = BNoteAttachment;
