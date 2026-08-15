#!/usr/bin/osascript
-- Ephemeral multi-line feedback dialog. Prints submitted text to stdout; stores nothing.
-- Tall empty NSTextView (no pre-filled blank lines).

use AppleScript version "2.4"
use framework "Foundation"
use framework "AppKit"
use scripting additions

property ca : current application

on run
	set NSApp to ca's NSApplication's sharedApplication()
	-- Regular policy so a CLI-launched alert can take focus
	NSApp's setActivationPolicy:(ca's NSApplicationActivationPolicyRegular)
	NSApp's activateIgnoringOtherApps:true
	
	set scrollFrame to ca's NSMakeRect(0, 0, 420, 160)
	set textView to ca's NSTextView's alloc()'s initWithFrame:scrollFrame
	textView's setRichText:false
	textView's setFont:(ca's NSFont's systemFontOfSize:13)
	textView's setString:""
	
	set scrollView to ca's NSScrollView's alloc()'s initWithFrame:scrollFrame
	scrollView's setHasVerticalScroller:true
	scrollView's setHasHorizontalScroller:false
	scrollView's setAutohidesScrollers:true
	scrollView's setBorderType:(ca's NSBezelBorder)
	scrollView's setDocumentView:textView
	
	set alert to ca's NSAlert's alloc()'s init()
	alert's setMessageText:"Optional feedback on this response?"
	alert's setAccessoryView:scrollView
	alert's addButtonWithTitle:"Submit"
	alert's addButtonWithTitle:"Skip"
	
	alert's |window|()'s makeKeyAndOrderFront:(missing value)
	NSApp's activateIgnoringOtherApps:true
	textView's setSelectedRange:{0, 0}
	
	set response to alert's runModal()
	if response is equal to (ca's NSAlertFirstButtonReturn) then
		return (textView's |string|() as text)
	end if
	return ""
end run
