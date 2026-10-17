"""Vendored F5-TTS inference code for the IndicF5 engine (MIT).

Source: AI4Bharat/IndicF5 (https://github.com/AI4Bharat/IndicF5),
itself based on SWivid/F5-TTS (https://github.com/SWivid/F5-TTS).
Both projects are MIT licensed — see LICENSE in this folder.

Only the inference path is kept here (model definition + a trimmed
inference pipeline). Nothing is executed from remote repositories: the
checkpoint, vocab and vocoder are all loaded from local files.
"""
