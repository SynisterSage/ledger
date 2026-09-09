require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LedgerCalendar'
  s.module_name    = 'LedgerCalendar'
  s.version        = package['version']
  s.summary        = 'Ledger Apple Calendar bridge'
  s.description    = 'Expo native module for reading Apple Calendar metadata on iOS.'
  s.author         = { 'Ledger' => 'engineering@ledgerworkspace.com' }
  s.homepage       = 'https://ledgerworkspace.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/ledgerworkspace/ledger.git' }
  s.static_framework = true
  s.dependency     'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
